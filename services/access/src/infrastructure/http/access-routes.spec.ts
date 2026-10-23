import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AuthWorkflows } from "../../application/auth-workflows";
import { DirectoryWorkflows } from "../../application/directory-workflows";
import { MemoryAccessStore } from "../../application/testing/memory-store";
import { ROLES } from "../../domain/catalog";
import type { SessionRecord, UserRecord } from "../../domain/records";
import { handleAccess, mountAccess, type AccessHttpDependencies, type AccessHttpRequest, type AccessHttpResult } from "./access-handler";

const now = new Date("2026-10-21T18:00:00.000Z");
const adminId = "00000000-0000-4000-8000-0000000000a1";
const sessionId = "00000000-0000-4000-8000-0000000000b1";
const otherSessionId = "00000000-0000-4000-8000-0000000000b2";
const roleId = "00000000-0000-4000-8000-0000000000c1";
const assignmentId = "00000000-0000-4000-8000-0000000000d1";
const csrf = "csrf-token-for-routes";
const sessionToken = "session-token-valid-value-ok";

function request(overrides: Partial<AccessHttpRequest> = {}): AccessHttpRequest {
  return {
    method: "GET",
    path: "/api/v1/access/me",
    query: {},
    body: {},
    cookie: `portal_csrf=${csrf}; portal_session=${sessionToken}`,
    csrf,
    authorization: undefined,
    correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ip: "127.0.0.1",
    secure: false,
    ...overrides,
  };
}

function routesDependencies(): AccessHttpDependencies {
  const store = new MemoryAccessStore();
  let sequence = 0x100;
  const random = {
    uuid: () => {
      sequence += 1;
      return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
    },
    token: () => "token-value",
    digits: () => "123456",
  };
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
    tokens: {
      async sign() { return sessionToken; },
      async verify(token) {
        return token === sessionToken
          ? { userId: adminId, sessionId, authorizationVersion: 1, restricted: false }
          : null;
      },
    },
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
    services: { async verify(header) { return header === "Bearer service-credential-value" ? "accounts" : null; } },
    jwks: async () => ({ keys: [{ kty: "RSA", kid: "active" }] }),
    pageDefault: 20,
    pageMax: 100,
    accessTokenTtl: 600,
    sessionAbsoluteTtl: 28800,
    recentVerificationTtl: 300,
    now: () => now,
  };
}

async function seed(deps: AccessHttpDependencies): Promise<void> {
  const admin: UserRecord = {
    id: adminId,
    email: "diego.admin@portal.local",
    emailNormalized: "diego.admin@portal.local",
    emailVerifiedAt: now.toISOString(),
    givenName: "Diego",
    familyName: "Admin",
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
  await deps.store.saveUser(admin);
  await deps.store.savePassword({ id: "00000000-0000-4000-8000-0000000000e1", userId: adminId, passwordHash: "hash:current-password", changedAt: now.toISOString(), revokedAt: null });
  const permissions = ROLES.find((role) => role.code === "administrador")?.permissions ?? [];
  await deps.store.saveRole({
    id: roleId,
    applicationId: "00000000-0000-4000-8000-0000000000f1",
    code: "administrador",
    name: "Administrador",
    description: "",
    system: true,
    assignableByAccessAdmin: true,
    version: 1,
    permissions: [...permissions],
    createdAt: now.toISOString(),
    deletedAt: null,
  });
  await deps.store.saveAssignment({
    id: assignmentId,
    userId: adminId,
    roleId,
    assignedBy: "seed",
    expiresAt: null,
    createdAt: now.toISOString(),
    deletedAt: null,
    deletedBy: null,
  });
  const session = (id: string): SessionRecord => ({
    id,
    userId: adminId,
    applicationCode: "portal",
    authenticationMethod: "password",
    verifiedAt: now.toISOString(),
    authorizationVersion: 1,
    restricted: false,
    csrfHash: createHash("sha256").update(csrf).digest("hex"),
    createdAt: now.toISOString(),
    expiresAt: "2026-10-21T20:00:00.000Z",
    lastSeenAt: now.toISOString(),
    revokedAt: null,
    revocationReason: null,
  });
  await deps.store.saveSession(session(sessionId));
  await deps.store.saveSession(session(otherSessionId));
}

function record(result: AccessHttpResult): Record<string, unknown> {
  return (result.body ?? {}) as Record<string, unknown>;
}

describe("access http routes", () => {
  it("serves profile, directory and service authorization for a real session", async () => {
    const deps = routesDependencies();
    await seed(deps);
    const call = (overrides: Partial<AccessHttpRequest>) => handleAccess(deps, request(overrides));

    expect((await call({ method: "GET", path: "/api/v1/access/missing" })).status).toBe(404);
    expect((await call({ method: "POST", path: "/api/v1/access/auth/login", body: {} })).status).toBe(422);
    const secureLogin = await call({ method: "POST", path: "/api/v1/access/auth/login", body: { email: "diego.admin@portal.local", password: "current-password" }, secure: true });
    expect(secureLogin.status).toBe(200);
    expect(JSON.stringify(secureLogin.headers["set-cookie"])).toContain("Secure");
    expect((await call({ method: "GET", path: "/api/v1/access/auth/oidc/google/start", query: { returnTo: "https://evil.example" } })).status).toBe(422);
    expect((await call({ method: "GET", path: "/api/v1/access/auth/oidc/microsoft/start", query: { returnTo: "/" } })).status).toBe(503);
    expect((await call({ method: "GET", path: "/api/v1/access/auth/oidc/google/callback", query: { code: "x", state: "y" } })).status).toBe(422);
    expect((await call({ method: "GET", path: "/api/v1/access/.well-known/jwks.json" })).body).toMatchObject({ keys: [{ kid: "active" }] });

    const profile = await call({ method: "GET", path: "/api/v1/access/me" });
    expect(profile.status).toBe(200);
    expect(record(profile).email).toBe("diego.admin@portal.local");
    expect((await call({ method: "GET", path: "/api/v1/access/me", cookie: undefined })).status).toBe(401);
    expect((await call({ method: "PATCH", path: "/api/v1/access/me", body: { phoneCountryCode: "MX", phoneNumber: "5512345678", themePreference: "dark" } })).status).toBe(200);
    expect((await call({ method: "GET", path: "/api/v1/access/me/permissions" })).status).toBe(200);
    expect((await call({ method: "GET", path: "/api/v1/access/me/sessions" })).status).toBe(200);
    expect((await call({ method: "GET", path: "/api/v1/access/me/passkeys" })).status).toBe(200);
    expect((await call({ method: "GET", path: "/api/v1/access/me/identities" })).status).toBe(200);
    expect((await call({ method: "POST", path: "/api/v1/access/me/passkeys/registration/options", body: {} })).status).toBe(503);
    expect((await call({ method: "POST", path: "/api/v1/access/me/identities/google/link", body: { returnTo: "/" } })).status).toBe(503);
    expect((await call({ method: "DELETE", path: "/api/v1/access/me/identities/00000000-0000-4000-8000-0000000000aa" })).status).toBe(404);
    expect((await call({ method: "POST", path: "/api/v1/access/auth/refresh" })).status).toBe(401);
    expect((await call({ method: "POST", path: "/api/v1/access/auth/password/forgot", body: { email: "missing@portal.local" }, cookie: undefined, csrf: undefined })).status).toBe(202);
    expect((await call({ method: "POST", path: "/api/v1/access/auth/password/reset", body: { token: "missing", password: "short" }, cookie: undefined, csrf: undefined })).status).toBe(422);
    expect((await call({ method: "GET", path: "/api/v1/access/users", query: { page: "0" } })).status).toBe(422);

    const users = await call({ method: "GET", path: "/api/v1/access/users" });
    expect(users.status).toBe(200);
    const invited = await call({ method: "POST", path: "/api/v1/access/users", body: { email: "nuevo@portal.local", givenName: "Nuevo", familyName: "Usuario" } });
    expect(invited.status).toBe(201);
    const invitedId = String(record(invited).id);
    expect((await call({ method: "GET", path: `/api/v1/access/users/${invitedId}` })).status).toBe(200);
    expect((await call({ method: "PATCH", path: `/api/v1/access/users/${invitedId}`, body: { givenName: "Nueva" } })).status).toBe(200);
    expect((await call({ method: "POST", path: `/api/v1/access/users/${adminId}/role-assignments`, body: { roleId } })).status).toBe(403);

    const createdApp = await call({ method: "POST", path: "/api/v1/access/applications", body: { code: "cobros", name: "Cobros" } });
    expect(createdApp.status).toBe(201);
    const applicationId = String(record(createdApp).id);
    expect((await call({ method: "GET", path: "/api/v1/access/applications" })).status).toBe(200);
    expect((await call({ method: "GET", path: `/api/v1/access/applications/${applicationId}` })).status).toBe(200);
    expect((await call({ method: "PATCH", path: `/api/v1/access/applications/${applicationId}`, body: { name: "Cobros locales" } })).status).toBe(200);
    expect((await call({ method: "GET", path: `/api/v1/access/applications/${applicationId}/permissions` })).status).toBe(200);

    const createdRole = await call({
      method: "POST",
      path: `/api/v1/access/applications/${applicationId}/roles`,
      body: { code: "consulta-http", name: "Consulta", permissionCodes: ["users:read"] },
    });
    expect(createdRole.status).toBe(201);
    const customRoleId = String(record(createdRole).id);
    expect((await call({ method: "GET", path: `/api/v1/access/applications/${applicationId}/roles` })).status).toBe(200);
    expect((await call({ method: "GET", path: `/api/v1/access/applications/${applicationId}/roles/${customRoleId}` })).status).toBe(200);
    expect((await call({ method: "PATCH", path: `/api/v1/access/applications/${applicationId}/roles/${customRoleId}`, body: { name: "Consulta local" } })).status).toBe(200);
    expect((await call({ method: "PUT", path: `/api/v1/access/applications/${applicationId}/roles/${customRoleId}/permissions`, body: { version: 9, permissionCodes: ["users:read"] } })).status).toBe(409);
    expect((await call({ method: "PUT", path: `/api/v1/access/applications/${applicationId}/roles/${customRoleId}/permissions`, body: { version: 1, permissionCodes: ["users:read"] } })).status).toBe(200);
    expect((await call({ method: "POST", path: `/api/v1/access/users/${invitedId}/role-assignments`, body: { roleId: customRoleId } })).status).toBe(204);
    const assignments = await call({ method: "GET", path: `/api/v1/access/users/${invitedId}/role-assignments` });
    expect(assignments.status).toBe(200);
    const assignment = (record(assignments).items as Array<{ id: string }>)[0];
    expect((await call({ method: "DELETE", path: `/api/v1/access/users/${invitedId}/role-assignments/${assignment?.id}` })).status).toBe(204);
    expect((await call({ method: "PATCH", path: `/api/v1/access/users/${invitedId}/passkey-policy`, body: { action: "enable" } })).status).toBe(204);
    const recovery = await call({ method: "POST", path: `/api/v1/access/users/${invitedId}/recovery-requests`, body: { reason: "perdió el acceso" } });
    expect(recovery.status).toBe(201);
    expect((await call({ method: "POST", path: `/api/v1/access/recovery-requests/${String(record(recovery).id)}/complete` })).status).toBe(422);
    expect((await call({ method: "DELETE", path: `/api/v1/access/users/${invitedId}` })).status).toBe(204);
    expect((await call({ method: "POST", path: `/api/v1/access/users/${invitedId}/restore` })).status).toBe(200);
    expect((await call({ method: "DELETE", path: `/api/v1/access/applications/${applicationId}/roles/${customRoleId}` })).status).toBe(204);
    expect((await call({ method: "POST", path: `/api/v1/access/applications/${applicationId}/roles/${customRoleId}/restore` })).status).toBe(200);
    expect((await call({ method: "DELETE", path: `/api/v1/access/applications/${applicationId}` })).status).toBe(204);
    expect((await call({ method: "POST", path: `/api/v1/access/applications/${applicationId}/restore` })).status).toBe(200);

    const denied = await call({
      method: "POST",
      path: "/internal/v1/access/authorize",
      authorization: "Bearer service-credential-value",
      body: { sessionToken, applicationCode: "portal", permission: "not-a-permission" },
    });
    expect(denied.status).toBe(200);
    expect(record(denied).decision).toBe("deny");
    const allowed = await call({
      method: "POST",
      path: "/internal/v1/access/authorize",
      authorization: "Bearer service-credential-value",
      body: { sessionToken, applicationCode: "portal", permission: "users:read", context: { resourceType: "user" } },
    });
    expect(allowed.status).toBe(200);
    expect(record(allowed)).toMatchObject({ decision: "allow", principal: { userId: adminId, sessionId }, recentlyVerified: true });
    expect(JSON.stringify(allowed.body)).not.toContain("current-password");
    const currentSession = await deps.store.findSession(sessionId);
    const verifiedAt = currentSession?.verifiedAt ?? now.toISOString();
    if (currentSession) {
      currentSession.verifiedAt = "2020-01-01T00:00:00.000Z";
      await deps.store.saveSession(currentSession);
    }
    const stale = await call({
      method: "POST",
      path: "/internal/v1/access/authorize",
      authorization: "Bearer service-credential-value",
      body: { sessionToken, applicationCode: "portal", permission: "users:read", requireRecentVerification: true },
    });
    expect(record(stale)).toMatchObject({ decision: "deny", reasonCode: "recent_verification_required" });
    if (currentSession) {
      currentSession.verifiedAt = verifiedAt;
      await deps.store.saveSession(currentSession);
    }
    expect((await call({ method: "POST", path: "/internal/v1/access/authorize", body: { sessionToken, applicationCode: "portal", permission: "users:read" } })).status).toBe(401);

    expect((await call({ method: "DELETE", path: `/api/v1/access/me/sessions/${otherSessionId}` })).status).toBe(204);
    expect((await call({ method: "POST", path: "/api/v1/access/me/password/change", body: { currentPassword: "current-password", newPassword: "another-password" } })).status).toBe(204);
    expect((await call({ method: "GET", path: "/api/v1/access/me" })).status).toBe(401);
  });

  it("maps unexpected failures and mounts only the access routes", async () => {
    const deps = routesDependencies();
    await seed(deps);
    const original = deps.auth.login.bind(deps.auth);
    deps.auth.login = async () => {
      throw new Error("boom");
    };
    const failed = await handleAccess(deps, request({ method: "POST", path: "/api/v1/access/auth/login", body: { email: "diego.admin@portal.local", password: "current-password" }, cookie: undefined, csrf: undefined }));
    expect(failed.status).toBe(500);
    expect(record(failed).code).toBe("UNEXPECTED_FAILURE");
    deps.auth.login = original;

    let captured: ((req: Request, res: Response, next: NextFunction) => void) | undefined;
    mountAccess({ use(handler) { captured = handler; } }, deps);
    const skipped = await new Promise<{ nexted: boolean }>((resolve) => {
      captured?.({ method: "GET", path: "/health", query: {}, header: () => undefined, ip: "127.0.0.1", secure: false } as unknown as Request, { getHeader: () => undefined } as unknown as Response, () => resolve({ nexted: true }));
    });
    expect(skipped.nexted).toBe(true);
    const mounted = await new Promise<{ status: number; body: unknown }>((resolve) => {
      const response = {
        headersSent: false,
        statusCode: 0,
        getHeader: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        setHeader() { return undefined; },
        status(code: number) { this.statusCode = code; return this; },
        json(body: unknown) { resolve({ status: this.statusCode, body }); },
        end() { resolve({ status: this.statusCode, body: undefined }); },
      };
      captured?.({ method: "GET", path: "/api/v1/access/me", query: {}, header: () => undefined, ip: "127.0.0.1", secure: false } as unknown as Request, response as unknown as Response, () => undefined);
    });
    expect(mounted.status).toBe(401);
  });
});
