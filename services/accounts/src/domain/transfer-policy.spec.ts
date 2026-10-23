import { AccountsError } from "./accounts-error";
import { mexicoDay } from "./mexico-day";
import { Money } from "./money";
import { commercialSpend } from "./spend";
import { decideTransfer, type ProposalSnapshot } from "./transfer-policy";
import type { MovementRecord } from "./records";

const now = new Date("2026-10-22T18:00:00.000Z");

function proposal(overrides: Partial<ProposalSnapshot> = {}): ProposalSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    userId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    sourceAccountId: "00000000-0000-4000-8000-0000000000a1",
    destinationAccountId: "00000000-0000-4000-8000-0000000000a2",
    amount: "60.00",
    currency: "MXN",
    status: "pending",
    expiresAt: "2026-10-22T18:05:00.000Z",
    rejectionReason: null,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof decideTransfer>[0]> = {}) {
  return {
    proposal: proposal(),
    source: { id: "00000000-0000-4000-8000-0000000000a1", customerId: "customer", status: "active" as const, currency: "MXN" as const, balance: "100.00" },
    destination: { id: "00000000-0000-4000-8000-0000000000a2", customerId: "other", status: "active" as const, currency: "MXN" as const, balance: "10.00" },
    ownerCustomerId: "customer",
    actorUserId: "00000000-0000-4000-8000-000000000001",
    actorSessionId: "00000000-0000-4000-8000-000000000002",
    perTransferLimit: "100.00",
    dailyLimit: "100.00",
    consumedToday: "0.00",
    now,
    requestHash: "hash-a",
    idempotency: null,
    existingTransferId: null,
    ...overrides,
  };
}

describe("transfer decision", () => {
  it("moves money only when funds and both limits allow it", () => {
    const posted = decideTransfer(input());
    expect(posted).toMatchObject({ kind: "post", sourceBalance: "40.00", destinationBalance: "70.00", consumed: "60.00" });
  });

  it("rejects an overdraft, a daily overflow and a per-transfer overflow", () => {
    expect(decideTransfer(input({ proposal: proposal({ amount: "80.00" }), source: { id: "00000000-0000-4000-8000-0000000000a1", customerId: "customer", status: "active", currency: "MXN", balance: "50.00" } }))).toMatchObject({ reason: "insufficient_funds" });
    expect(decideTransfer(input({ consumedToday: "50.00" }))).toMatchObject({ reason: "daily_limit" });
    expect(decideTransfer(input({ perTransferLimit: "10.00", dailyLimit: "100.00" }))).toMatchObject({ reason: "per_transfer_limit" });
  });

  it("replays the same key and rejects a different payload or a second key", () => {
    expect(decideTransfer(input({ idempotency: { requestHash: "hash-a", transferId: "transfer-1", status: "completed", reasonCode: null } }))).toEqual({ kind: "replay", transferId: "transfer-1" });
    expect(decideTransfer(input({ idempotency: { requestHash: "other", transferId: null, status: "rejected", reasonCode: null } })).kind).toBe("conflict");
    expect(decideTransfer(input({ existingTransferId: "transfer-1" }))).toMatchObject({ kind: "conflict", code: "CONFLICT" });
  });

  it("hides another session and rejects expiry, a closed account and a recorded rejection", () => {
    expect(decideTransfer(input({ actorSessionId: "00000000-0000-4000-8000-000000000099" })).kind).toBe("hidden");
    expect(decideTransfer(input({ proposal: proposal({ expiresAt: "2026-10-22T17:00:00.000Z" }) }))).toMatchObject({ status: "expired", alreadyRecorded: false });
    expect(decideTransfer(input({ source: { id: "00000000-0000-4000-8000-0000000000a1", customerId: "customer", status: "closed", currency: "MXN", balance: "100.00" } }))).toMatchObject({ reason: "account_unavailable" });
    expect(decideTransfer(input({ idempotency: { requestHash: "hash-a", transferId: null, status: "rejected", reasonCode: "insufficient_funds" } }))).toMatchObject({ alreadyRecorded: true, reason: "insufficient_funds" });
  });

  it("keeps commercial spend apart from transfers and splits the Mexico day", () => {
    const movements: MovementRecord[] = [
      movement("purchase", "out", "30.00", "2026-10-22T18:00:00.000Z"),
      movement("transfer", "out", "80.00", "2026-10-22T18:00:00.000Z"),
      movement("purchase", "out", "15.00", "2026-10-22T05:00:00.000Z"),
    ];
    const day = mexicoDay(now);
    expect(commercialSpend(movements, day.key, (value) => mexicoDay(new Date(value)).key)).toBe("30.00");
    expect(mexicoDay(new Date("2026-10-22T05:59:59.000Z")).key).toBe("2026-10-21");
    expect(mexicoDay(new Date("2026-10-22T06:00:00.000Z")).key).toBe("2026-10-22");
    expect(mexicoDay(new Date("2026-10-22T06:00:00.000Z")).start.toISOString()).toBe("2026-10-22T06:00:00.000Z");
  });

  it("rejects a zero amount and keeps decimal strings exact", () => {
    expect(decideTransfer(input({ proposal: proposal({ amount: "0.00" }) }))).toMatchObject({ reason: "amount" });
    expect(Money.parse("10000.10").subtract(Money.parse("0.10")).format()).toBe("10000.00");
    expect(thrown(() => Money.parse("10")).code).toBe("VALIDATION_ERROR");
    expect(Money.parse("1.00").compare(Money.parse("1.00"))).toBe(0);
    expect(Money.parse("1.00").compare(Money.parse("2.00"))).toBe(-1);
    expect(thrown(() => Money.fromCents(-1n)).code).toBe("BUSINESS_RULE");
    expect(thrown(() => Money.parse("1.00").subtract(Money.parse("2.00"))).code).toBe("BUSINESS_RULE");
    expect(decideTransfer(input({ source: { id: "00000000-0000-4000-8000-0000000000a1", customerId: "customer", status: "active", currency: "MXN", balance: "100.00" }, destination: { id: "00000000-0000-4000-8000-0000000000a1", customerId: "other", status: "active", currency: "MXN", balance: "10.00" }, proposal: proposal({ destinationAccountId: "00000000-0000-4000-8000-0000000000a1" }) }))).toMatchObject({ reason: "same_account" });
    expect(decideTransfer(input({ proposal: proposal({ status: "cancelled" }) }))).toMatchObject({ reason: "proposal_cancelled", alreadyRecorded: true });
    expect(() => mexicoDay(now, "UTC")).toThrow("invalid_time_zone");
  });
});

function thrown(run: () => void): AccountsError {
  try {
    run();
  } catch (error) {
    if (error instanceof AccountsError) {
      return error;
    }
  }
  throw new Error("expected_accounts_error");
}

function movement(type: MovementRecord["type"], direction: MovementRecord["direction"], amount: string, recordedAt: string): MovementRecord {
  return {
    id: `${type}-${recordedAt}`,
    accountId: "account",
    transferId: type === "transfer" ? "transfer" : null,
    type,
    direction,
    amount,
    currency: "MXN",
    balanceAfter: "0.00",
    recordedAt,
  };
}
