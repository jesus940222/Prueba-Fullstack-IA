import { AccountsError } from "../domain/accounts-error";
import { movementBalance } from "../domain/spend";
import { AccountsWorkflows } from "./accounts-workflows";
import { publishPending } from "./outbox";
import type { Authorizer } from "./ports";
import { MemoryAccountsStore } from "./testing/memory-store";

const now = new Date("2026-10-22T18:00:00.000Z");
const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const otherUser = "00000000-0000-4000-8000-000000000003";
const otherSession = "00000000-0000-4000-8000-000000000004";
const customerId = "00000000-0000-4000-8000-0000000000c1";
const otherCustomer = "00000000-0000-4000-8000-0000000000c2";
const sourceId = "00000000-0000-4000-8000-0000000000a1";
const destinationId = "00000000-0000-4000-8000-0000000000a2";
const closedId = "00000000-0000-4000-8000-0000000000a3";

function harness(authorizer?: Authorizer) {
  const store = new MemoryAccountsStore();
  store.customers.push(
    { id: customerId, customerNumber: "C-1001", givenName: "Ana", familyName: "Cliente", status: "active" },
    { id: otherCustomer, customerNumber: "C-1002", givenName: "Bruno", familyName: "Soporte", status: "active" },
  );
  store.links.push({ userId, customerId }, { userId: otherUser, customerId: otherCustomer });
  store.accounts.push(
    account(sourceId, customerId, "1000000000000001", "100.00"),
    account(destinationId, otherCustomer, "1000000000000003", "10.00"),
    account(closedId, otherCustomer, "1000000000000009", "5.00", "closed"),
  );
  store.movements.push({
    id: "opening",
    accountId: sourceId,
    transferId: null,
    type: "opening",
    direction: "in",
    amount: "100.00",
    currency: "MXN",
    balanceAfter: "100.00",
    recordedAt: "2026-10-22T12:00:00.000Z",
  });
  let sequence = 0;
  const workflows = new AccountsWorkflows(
    store,
    authorizer ?? { async authorize() { return { userId, sessionId }; } },
    { now: () => now },
    { uuid: () => { sequence += 1; return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`; } },
    {
      perTransferDefault: "100.00",
      dailyDefault: "100.00",
      perTransferMax: "50000.00",
      dailyMax: "100000.00",
      proposalTtlSeconds: 300,
      resolveLimit: 3,
      resolveWindowSeconds: 60,
    },
  );
  return { store, workflows };
}

function account(id: string, owner: string, accountNumber: string, balance: string, status: "active" | "closed" = "active") {
  return {
    id,
    customerId: owner,
    accountNumber,
    name: "Cuenta",
    currency: "MXN" as const,
    status,
    balance,
    closedAt: status === "closed" ? now.toISOString() : null,
    createdAt: "2026-10-01T06:00:00.000Z",
  };
}

describe("account workflows", () => {
  it("prepares an immutable proposal and confirms it once across keys and retries", async () => {
    const { store, workflows } = harness();
    const proposal = await workflows.createProposal("token", {
      sourceAccountId: sourceId,
      destinationAccountNumber: "1000000000000003",
      amount: "60.00",
      currency: "MXN",
      concept: "Renta",
    });
    expect(proposal.status).toBe("pending");
    const first = await workflows.confirmProposal("token", proposal.id, "idempotency-key-0001", "corr");
    const replay = await workflows.confirmProposal("token", proposal.id, "idempotency-key-0001", "corr");
    expect(replay.id).toBe(first.id);
    await expect(workflows.confirmProposal("token", proposal.id, "idempotency-key-0002", "corr")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.transfers).toHaveLength(1);
    expect(store.accounts.find((item) => item.id === sourceId)?.balance).toBe("40.00");
    expect(movementBalance(store.movements.filter((item) => item.accountId === sourceId))).toBe("40.00");
    expect(store.outbox.filter((item) => item.eventType === "transfer.completed")).toHaveLength(1);
    await expect(publishPending(store, { async publish() { throw new Error("broker_down"); } }, 20, now.toISOString())).rejects.toThrow("broker_down");
    expect(store.transfers).toHaveLength(1);
    expect(store.outbox.every((item) => item.publishedAt === null)).toBe(true);
    await publishPending(store, { async publish() { return undefined; } }, 20, now.toISOString());
    expect(store.outbox.find((item) => item.eventType === "transfer.completed")?.publishedAt).toBe(now.toISOString());
  });

  it("rejects a different payload for the same key, expiry, foreign accounts and a revoked recheck", async () => {
    const { store, workflows } = harness();
    const first = await workflows.createProposal("token", {
      sourceAccountId: sourceId,
      destinationAccountNumber: "1000000000000003",
      amount: "10.00",
      currency: "MXN",
      concept: "Uno",
    });
    await workflows.confirmProposal("token", first.id, "same-key-00000001", "corr");
    const second = await workflows.createProposal("token", {
      sourceAccountId: sourceId,
      destinationAccountNumber: "1000000000000003",
      amount: "10.00",
      currency: "MXN",
      concept: "Dos",
    });
    await expect(workflows.confirmProposal("token", second.id, "same-key-00000001", "corr")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const expired = await workflows.createProposal("token", {
      sourceAccountId: sourceId,
      destinationAccountNumber: "1000000000000003",
      amount: "10.00",
      currency: "MXN",
      concept: "Tarde",
    });
    const stored = store.proposals.find((item) => item.id === expired.id);
    if (stored) {
      stored.expiresAt = "2026-10-22T17:00:00.000Z";
    }
    await expect(workflows.confirmProposal("token", expired.id, "expired-key-000001", "corr")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(workflows.getAccount("token", destinationId)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    let calls = 0;
    const revoked = harness({
      async authorize() {
        calls += 1;
        if (calls > 1) {
          throw new AccountsError("SESSION_INVALID", "La sesión no es válida");
        }
        return { userId, sessionId };
      },
    });
    const pending = await revoked.workflows.createProposal("token", {
      sourceAccountId: sourceId,
      destinationAccountNumber: "1000000000000003",
      amount: "10.00",
      currency: "MXN",
      concept: "Revocada",
    });
    await expect(revoked.workflows.confirmProposal("token", pending.id, "revoked-key-000001", "corr")).rejects.toMatchObject({ code: "SESSION_INVALID" });
    expect(revoked.store.transfers).toHaveLength(0);
    expect(revoked.store.accounts.find((item) => item.id === sourceId)?.balance).toBe("100.00");
  });

  it("keeps the daily bucket on the Mexico day and blocks another session", async () => {
    const { store, workflows } = harness();
    store.usage.set(`${userId}:2026-10-22`, "50.00");
    await expect(workflows.createProposal("token", {
      sourceAccountId: sourceId,
      destinationAccountNumber: "1000000000000003",
      amount: "60.00",
      currency: "MXN",
      concept: "Día",
    })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    store.usage.set(`${userId}:2026-10-21`, "100.00");
    const proposal = await workflows.createProposal("token", {
      sourceAccountId: sourceId,
      destinationAccountNumber: "1000000000000003",
      amount: "40.00",
      currency: "MXN",
      concept: "Cabe",
    });
    const other = harness({ async authorize() { return { userId, sessionId: otherSession }; } });
    other.store.proposals = store.proposals;
    await expect(other.workflows.getProposal("token", proposal.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    await workflows.confirmProposal("token", proposal.id, "daily-key-0000001", "corr");
    expect(store.usage.get(`${userId}:2026-10-22`)).toBe("90.00");
  });

  it("resolves an occasional recipient without opening a directory and pages an empty range", async () => {
    const { workflows } = harness();
    const resolved = await workflows.resolveRecipient("token", "1000000000000003");
    expect(resolved.accountNumberMasked.endsWith("0003")).toBe(true);
    expect(resolved.holderLabel).toBe("Bruno S.");
    await expect(workflows.resolveRecipient("token", "1000000000000009")).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    await expect(workflows.resolveRecipient("token", "1000000000000099")).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    await expect(workflows.resolveRecipient("token", "1000000000000003")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const page = await workflows.listAccounts("token", { page: 9, pageSize: 20, sort: "-createdAt" });
    expect(page.items).toEqual([]);
    expect(page.totalItems).toBe(1);
    const summary = await workflows.summary("token");
    expect(summary.spendTotal).toBe("0.00");
    expect(summary.totalBalance).toBe("100.00");
  });

  it("saves, renames and deletes a beneficiary without changing history", async () => {
    const { store, workflows } = harness();
    const saved = await workflows.createBeneficiary("token", destinationId, "Bruno", "corr");
    const renamed = await workflows.renameBeneficiary("token", saved.id, "Bruno actualizado", "corr");
    expect(renamed.alias).toBe("Bruno actualizado");
    const proposal = await workflows.createProposal("token", {
      sourceAccountId: sourceId,
      beneficiaryId: saved.id,
      amount: "10.00",
      currency: "MXN",
      concept: "Alias",
    });
    await workflows.deleteBeneficiary("token", saved.id, "corr");
    expect(store.beneficiaries[0]?.status).toBe("deleted");
    expect(proposal.destinationLabel).toContain("Bruno S.");
    const confirmed = await workflows.confirmProposal("token", proposal.id, "beneficiary-key-01", "corr");
    const receipt = await workflows.receipt("token", confirmed.id);
    expect(receipt.destinationLabel).toBe(proposal.destinationLabel);
    await expect(workflows.createProposal("token", { sourceAccountId: sourceId, beneficiaryId: saved.id, amount: "10.00", currency: "MXN", concept: "Borrado" })).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
  });

  it("rejects limits above the ceiling and an inactive caller", async () => {
    const { workflows } = harness({
      async authorize(_token, permission, recent) {
        if (permission === "transfer-limits:update:own" && !recent) {
          throw new AccountsError("RECENT_VERIFICATION_REQUIRED", "Se requiere una verificación reciente");
        }
        if (permission === "accounts:read:own") {
          throw new AccountsError("SESSION_INVALID", "La sesión no es válida");
        }
        return { userId, sessionId };
      },
    });
    await expect(workflows.updateLimits("token", "20.00", "10.00", "corr")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const updated = await workflows.updateLimits("token", "20.00", "40.00", "corr");
    expect(updated.perTransferLimit).toBe("20.00");
    await expect(workflows.summary("token")).rejects.toMatchObject({ code: "SESSION_INVALID" });
    const foreign = harness({ async authorize() { return { userId: otherUser, sessionId: otherSession }; } });
    await expect(foreign.workflows.getAccount("token", sourceId)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
  });

  it("returns an unverifiable eligibility context when the customer is missing", async () => {
    const { workflows } = harness();
    expect(await workflows.eligibility("00000000-0000-4000-8000-000000000099", ["totalBalance", "accountAgeDays"])).toEqual({
      customerId: "00000000-0000-4000-8000-000000000099",
      verifiable: false,
    });
    const context = await workflows.eligibility(customerId, ["totalBalance", "accountAgeDays"]);
    expect(context).toMatchObject({ verifiable: true, attributes: { totalBalance: "100.00", accountAgeDays: 21 } });
    expect(await workflows.customerLink(userId)).toEqual({ userId, customerId });
    const missingUser = "00000000-0000-4000-8000-000000000099";
    expect(await workflows.customerLink(missingUser)).toEqual({ userId: missingUser, customerId: null });
  });
});
