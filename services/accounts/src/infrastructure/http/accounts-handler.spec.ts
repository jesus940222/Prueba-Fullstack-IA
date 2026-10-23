import type { NextFunction, Request, Response } from "express";
import { SignJWT } from "jose";
import { AccountsError } from "../../domain/accounts-error";
import { AccountsWorkflows } from "../../application/accounts-workflows";
import { MemoryAccountsStore } from "../../application/testing/memory-store";
import { handleAccounts, mountAccounts, type AccountsHttpDependencies, type AccountsHttpRequest } from "./accounts-handler";

const now = new Date("2026-10-22T18:00:00.000Z");
const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const customerId = "00000000-0000-4000-8000-0000000000c1";
const sourceId = "00000000-0000-4000-8000-0000000000a1";
const destinationId = "00000000-0000-4000-8000-0000000000a2";
const csrf = "csrf-token-accounts";

function request(overrides: Partial<AccountsHttpRequest> = {}): AccountsHttpRequest {
  return {
    method: "GET",
    path: "/api/v1/accounts/summary",
    query: {},
    body: {},
    cookie: `portal_csrf=${csrf}; portal_session=session-token-value`,
    csrf,
    authorization: undefined,
    idempotencyKey: undefined,
    correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...overrides,
  };
}

function dependencies(authorize: AccountsWorkflows extends never ? never : () => Promise<{ userId: string; sessionId: string }> = async () => ({ userId, sessionId })): AccountsHttpDependencies {
  const store = new MemoryAccountsStore();
  store.customers.push({ id: customerId, customerNumber: "C-1", givenName: "Ana", familyName: "Cliente", status: "active" });
  store.links.push({ userId, customerId });
  store.accounts.push(
    { id: sourceId, customerId, accountNumber: "1000000000000001", name: "Nómina", currency: "MXN", status: "active", balance: "100.00", closedAt: null, createdAt: now.toISOString() },
    { id: destinationId, customerId: "00000000-0000-4000-8000-0000000000c2", accountNumber: "1000000000000003", name: "Operativa", currency: "MXN", status: "active", balance: "50.00", closedAt: null, createdAt: now.toISOString() },
  );
  store.customers.push({ id: "00000000-0000-4000-8000-0000000000c2", customerNumber: "C-2", givenName: "Bruno", familyName: "Soporte", status: "active" });
  store.movements.push(
    { id: "00000000-0000-4000-8000-0000000000m1", accountId: sourceId, transferId: null, type: "opening", direction: "in", amount: "100.00", currency: "MXN", balanceAfter: "100.00", recordedAt: now.toISOString() },
    { id: "00000000-0000-4000-8000-0000000000m2", accountId: destinationId, transferId: null, type: "opening", direction: "in", amount: "50.00", currency: "MXN", balanceAfter: "50.00", recordedAt: now.toISOString() },
  );
  let sequence = 20;
  return {
    workflows: new AccountsWorkflows(store, { authorize }, { now: () => now }, {
      uuid: () => { sequence += 1; return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`; },
    }, {
      perTransferDefault: "100.00",
      dailyDefault: "100.00",
      perTransferMax: "50000.00",
      dailyMax: "100000.00",
      proposalTtlSeconds: 300,
      resolveLimit: 5,
      resolveWindowSeconds: 60,
    }),
    pageDefault: 20,
    pageMax: 100,
    cursorDefault: 20,
    cursorMax: 50,
    eligibilitySecrets: { catalog: "", ai: "" },
  };
}

describe("accounts http", () => {
  it("confirms only after an explicit request and keeps a revoked session out", async () => {
    const deps = dependencies();
    const call = (overrides: Partial<AccountsHttpRequest>) => handleAccounts(deps, request(overrides));
    expect((await call({ method: "GET", path: "/api/v1/accounts/missing" })).status).toBe(404);
    expect((await call({ method: "POST", path: "/api/v1/accounts/transfer-proposals", csrf: "nope" })).status).toBe(403);
    expect((await call({ method: "GET", path: "/api/v1/accounts/accounts", query: { sort: "balance" } })).status).toBe(422);
    const summary = await call({});
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ currency: "MXN", totalBalance: "100.00", spendTotal: "0.00" });
    const created = await call({
      method: "POST",
      path: "/api/v1/accounts/transfer-proposals",
      body: { sourceAccountId: sourceId, destinationAccountNumber: "1000000000000003", amount: "25.00", currency: "MXN", concept: "Renta" },
    });
    expect(created.status).toBe(201);
    const proposalId = (created.body as { id: string }).id;
    const missingKey = await call({ method: "POST", path: `/api/v1/accounts/transfer-proposals/${proposalId}/confirm`, body: {} });
    expect(missingKey.status).toBe(422);
    const confirmed = await call({
      method: "POST",
      path: `/api/v1/accounts/transfer-proposals/${proposalId}/confirm`,
      body: {},
      idempotencyKey: "idempotency-key-0001",
    });
    expect(confirmed).toMatchObject({ status: 200, body: { status: "completed", amount: "25.00" } });
    expect(confirmed.body).toMatchObject({ status: "completed", amount: "25.00" });
    const receipt = await call({ method: "GET", path: `/api/v1/accounts/transfers/${(confirmed.body as { id: string }).id}/receipt` });
    expect(receipt.status).toBe(200);
    const revoked = dependencies(async () => { throw new AccountsError("SESSION_INVALID", "La sesión no es válida"); });
    expect((await handleAccounts(revoked, request())).status).toBe(401);
    expect((await call({ method: "GET", path: "/api/v1/accounts/accounts", query: { page: "4" } })).body).toMatchObject({ items: [], page: 4 });
  });

  it("mounts only the accounts routes and reports an unconfigured eligibility caller", async () => {
    const deps = dependencies();
    expect((await handleAccounts(deps, request({ method: "POST", path: "/internal/v1/accounts/eligibility-context", body: { customerId: customerId, fields: ["totalBalance"] } }))).status).toBe(503);
    let captured: ((req: Request, res: Response, next: NextFunction) => void) | undefined;
    mountAccounts({ use(handler) { captured = handler; } }, deps);
    const skipped = await new Promise<{ nexted: boolean }>((resolve) => {
      captured?.({ method: "GET", path: "/health", query: {}, header: () => undefined } as unknown as Request, { getHeader: () => undefined, headersSent: false } as unknown as Response, () => resolve({ nexted: true }));
    });
    expect(skipped.nexted).toBe(true);
  });

  it("covers beneficiaries, movements, limits and a signed eligibility call", async () => {
    const deps = dependencies();
    const call = (overrides: Partial<AccountsHttpRequest>) => handleAccounts(deps, request(overrides));
    expect((await call({ method: "GET", path: `/api/v1/accounts/accounts/${sourceId}` })).status).toBe(200);
    expect((await call({ method: "GET", path: `/api/v1/accounts/accounts/${sourceId}/movements`, query: { direction: "out" } })).status).toBe(200);
    expect((await call({ method: "GET", path: `/api/v1/accounts/accounts/${sourceId}/movements`, query: { direction: "sideways" } })).status).toBe(422);
    expect((await call({ method: "GET", path: `/api/v1/accounts/accounts/${sourceId}/movements`, query: { from: "ayer" } })).status).toBe(422);
    expect((await call({ method: "GET", path: "/api/v1/accounts/transfers" })).status).toBe(200);
    expect((await call({ method: "GET", path: `/api/v1/accounts/transfers/${sourceId}` })).status).toBe(404);
    expect((await call({ method: "GET", path: "/api/v1/accounts/beneficiaries", query: { search: "x".repeat(81) } })).status).toBe(422);
    expect((await call({ method: "GET", path: "/api/v1/accounts/beneficiaries", query: { limit: "99" } })).status).toBe(422);
    const created = await call({
      method: "POST",
      path: "/api/v1/accounts/beneficiaries",
      body: { destinationAccountId: destinationId, alias: "Bruno" },
    });
    expect(created.status).toBe(201);
    const beneficiaryId = (created.body as { id: string }).id;
    expect((await call({ method: "GET", path: "/api/v1/accounts/beneficiaries", query: { search: "Bru" } })).status).toBe(200);
    expect((await call({ method: "PATCH", path: `/api/v1/accounts/beneficiaries/${beneficiaryId}`, body: { alias: "Bruno operativo" } })).status).toBe(200);
    expect((await call({ method: "POST", path: "/api/v1/accounts/recipients/resolve", body: { destinationAccountNumber: "1000000000000003" } })).status).toBe(200);
    expect((await call({ method: "POST", path: "/api/v1/accounts/recipients/resolve", body: { destinationAccountNumber: "12" } })).status).toBe(422);
    const proposal = await call({
      method: "POST",
      path: "/api/v1/accounts/transfer-proposals",
      body: { sourceAccountId: sourceId, beneficiaryId, amount: "10.00", currency: "MXN", concept: "Ahorro" },
    });
    expect(proposal.status).toBe(201);
    const proposalId = (proposal.body as { id: string }).id;
    expect((await call({ method: "GET", path: `/api/v1/accounts/transfer-proposals/${proposalId}` })).status).toBe(200);
    expect((await call({
      method: "POST",
      path: `/api/v1/accounts/transfer-proposals/${proposalId}/confirm`,
      body: { extra: true },
      idempotencyKey: "idempotency-key-0002",
    })).status).toBe(422);
    expect((await call({ method: "DELETE", path: `/api/v1/accounts/transfer-proposals/${proposalId}` })).status).toBe(204);
    expect((await call({ method: "GET", path: "/api/v1/accounts/me/transfer-limits" })).status).toBe(200);
    expect((await call({ method: "PATCH", path: "/api/v1/accounts/me/transfer-limits", body: { perTransferLimit: "20.00", dailyLimit: "40.00" } })).status).toBe(200);
    expect((await call({ method: "PATCH", path: "/api/v1/accounts/me/transfer-limits", body: { perTransferLimit: "40.00", dailyLimit: "20.00" } })).status).toBe(422);
    expect((await call({ method: "DELETE", path: `/api/v1/accounts/beneficiaries/${beneficiaryId}` })).status).toBe(204);
    const broken = {
      ...deps,
      workflows: { summary: async () => { throw new Error("boom"); } } as unknown as AccountsWorkflows,
    };
    expect((await handleAccounts(broken, request())).status).toBe(500);
    const secret = "catalog-secret-must-be-32-chars!!";
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer("catalog").setAudience("accounts.eligibility").setSubject("catalog").setIssuedAt().setExpirationTime("2m").sign(new TextEncoder().encode(secret));
    const eligible = await handleAccounts(
      { ...deps, eligibilitySecrets: { catalog: secret, ai: "" } },
      request({ method: "POST", path: "/internal/v1/accounts/eligibility-context", authorization: `Bearer ${token}`, body: { customerId, fields: ["totalBalance"] } }),
    );
    expect(eligible.status).toBe(200);
    expect(eligible.body).toMatchObject({ verifiable: true });
    const link = await handleAccounts(
      { ...deps, eligibilitySecrets: { catalog: secret, ai: "" } },
      request({ method: "POST", path: "/internal/v1/accounts/customer-link", authorization: `Bearer ${token}`, body: { userId } }),
    );
    expect(link.body).toEqual({ userId, customerId });
  });

  it("writes the adapter response and reports an unexpected failure", async () => {
    const deps = dependencies();
    let captured: ((req: Request, res: Response, next: NextFunction) => void) | undefined;
    mountAccounts({ use(handler) { captured = handler; } }, deps);
    const json = jest.fn();
    const end = jest.fn();
    const response = {
      getHeader: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn(() => ({ json, end })),
    } as unknown as Response;
    captured?.({
      method: "GET",
      path: "/api/v1/accounts/summary",
      query: {},
      header: (name: string) => name === "cookie" ? `portal_csrf=${csrf}; portal_session=session-token-value` : undefined,
    } as unknown as Request, response, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalled();
    let writes = 0;
    const failedJson = jest.fn(() => {
      writes += 1;
      if (writes === 1) {
        throw new Error("write");
      }
    });
    const failed = {
      getHeader: () => undefined,
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn(() => ({ json: failedJson, end: jest.fn() })),
    } as unknown as Response;
    captured?.({ method: "GET", path: "/api/v1/accounts/summary", query: {}, header: () => undefined } as unknown as Request, failed, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    expect(failed.status).toHaveBeenCalledWith(500);
  });
});
