import { AuthWorkflows } from "../../application/auth-workflows";
import { DirectoryWorkflows } from "../../application/directory-workflows";
import { MemoryAccessStore } from "../../application/testing/memory-store";
import type { UserRecord } from "../../domain/records";
import { handleAccess, type AccessHttpDependencies, type AccessHttpRequest } from "./access-handler";

const now = new Date("2026-10-21T18:00:00.000Z");

function request(overrides: Partial<AccessHttpRequest> = {}): AccessHttpRequest {
  return {
    method: "POST",
    path: "/api/v1/access/auth/login",
    query: {},
    body: {},
    cookie: undefined,
    csrf: undefined,
    authorization: undefined,
    correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ip: "127.0.0.1",
    secure: false,
    ...overrides,
  };
}

function dependencies(): AccessHttpDependencies {
  const store = new MemoryAccessStore();
  const random = { uuid: () => "00000000-0000-4000-8000-000000000099", token: () => "token", digits: () => "123456" };
  const clock = { now: () => now };
  const codes = { protect: (binding: string, code: string) => `${binding}:${code}`, same: (left: string, right: string) => left === right };
  const mailer = { async send() { return undefined; } };
  const limits = {
    accessTokenTtl: 600,
    sessionAbsoluteTtl: 28800,
    sessionIdleTtl: 1800,
    emailCodeTtl: 300,
    emailCodeAttempts: 5,
    recentVerificationTtl: 300,
    passwordMinLength: 12,
    recoveryCodeCount: 10,
    pageDefault: 20,
    pageMax: 100,
    loginAccountFailures: 8,
    loginIpFailures: 30,
    loginWindowSeconds: 900,
    resendLimit: 3,
  };
  const auth = new AuthWorkflows({
    store,
    passwords: { async hash(password) { return `hash:${password}`; }, async verify(password, hash) { return hash === `hash:${password}`; } },
    codes,
    mailer,
    tokens: { async sign() { return "jwt-token-value-with-enough-length"; }, async verify() { return null; } },
    webauthn: { configured: () => false, async registrationOptions() { return {}; }, async verifyRegistration() { return null; }, async authenticationOptions() { return {}; }, async verifyAuthentication() { return null; } },
    oidc: { configured: () => false, start: () => "https://idp.example/start", async exchange() { return "unavailable"; } },
    rates: { async hit() { return "ok"; } },
    random,
    clock,
    limits,
    portalUrl: "http://localhost:8080",
  });
  return {
    auth,
    directory: new DirectoryWorkflows(store, random, clock, codes, mailer, "http://localhost:8080", 300),
    store,
    services: { async verify() { return null; } },
    jwks: async () => ({ keys: [] }),
    pageDefault: 20,
    pageMax: 100,
    accessTokenTtl: 600,
    sessionAbsoluteTtl: 28800,
    recentVerificationTtl: 300,
    now: () => now,
  };
}

describe("access http", () => {
  it("rejects an unknown password without returning a token", async () => {
    const deps = dependencies();
    const account: UserRecord = {
      id: "00000000-0000-4000-8000-000000000010",
      email: "ana@portal.local",
      emailNormalized: "ana@portal.local",
      emailVerifiedAt: now.toISOString(),
      givenName: "Ana",
      familyName: "López",
      status: "active",
      authorizationVersion: 1,
      themePreference: "system",
      phoneCountryCode: null,
      phoneCallingCode: null,
      phoneNumber: null,
      phoneE164: null,
      lastLoginAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deletedAt: null,
      deletedBy: null,
    };
    await deps.store.saveUser(account);
    await deps.store.savePassword({ id: "pw", userId: account.id, passwordHash: "hash:correct-password", changedAt: account.createdAt, revokedAt: null });
    const denied = await handleAccess(deps, request({ body: { email: account.email, password: "wrong-password" } }));
    expect(denied.status).toBe(401);
    expect(JSON.stringify(denied.body)).not.toContain("hash:");
    const started = await handleAccess(deps, request({ body: { email: account.email, password: "correct-password" } }));
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ nextStep: "EMAIL_CHALLENGE" });
    expect(JSON.stringify(started.body)).not.toContain("123456");
    const missingCsrf = await handleAccess(deps, request({ path: "/api/v1/access/auth/challenges/00000000-0000-4000-8000-000000000099/email/verify", body: { proof: "123456" } }));
    expect(missingCsrf.status).toBe(403);
    const keys = await handleAccess(deps, request({ method: "GET", path: "/api/v1/access/.well-known/jwks.json" }));
    expect(keys.status).toBe(200);
    const unauthorized = await handleAccess(deps, request({ method: "POST", path: "/internal/v1/access/authorize", body: { sessionToken: "abcdefghijklmnopqrst", applicationCode: "portal", permission: "users:read" } }));
    expect(unauthorized.status).toBe(401);
    const admin = { ...account, id: "00000000-0000-4000-8000-000000000011", email: "diego.admin@portal.local", emailNormalized: "diego.admin@portal.local" };
    const stranger = { ...account, id: "00000000-0000-4000-8000-000000000012", email: "otro@portal.local", status: "disabled" as const };
    await deps.store.saveUser(admin);
    await deps.store.saveUser(stranger);
    deps.store.permissionsFor = async (userId: string) => (userId === admin.id ? ["ai:alerts:read"] : []);
    deps.services.verify = async (_header, audience) => (audience === "access.alert-recipients" ? "ai" : null);
    const contacts = await handleAccess(deps, request({
      path: "/internal/v1/access/alert-recipients",
      authorization: "Bearer service-token",
      body: { userIds: [admin.id, stranger.id] },
    }));
    expect(contacts.status).toBe(200);
    expect(contacts.body).toEqual({ recipients: [{ userId: admin.id, email: admin.email }] });
    const everyone = await handleAccess(deps, request({
      path: "/internal/v1/access/alert-recipients",
      authorization: "Bearer service-token",
      body: {},
    }));
    expect(everyone.status).toBe(200);
    expect(everyone.body).toEqual({ recipients: [{ userId: admin.id, email: admin.email }] });
  });
});
