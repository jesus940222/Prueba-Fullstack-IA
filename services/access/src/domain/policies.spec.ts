import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCESS_ERROR_CODES, AccessError, httpStatusFor } from "./access-error";
import { decideAuthorization, sessionInvalid } from "./authorization";
import { DELEGABLE_CUSTOM_ROLE_PERMISSIONS, PERMISSIONS, ROLES, UNASSIGNED_PERMISSIONS } from "./catalog";
import { assessProof } from "./challenge-policy";
import {
  assertCanAssignRole,
  assertCanReplaceRolePermissions,
  assertCustomRolePermissions,
  assertKeepsEffectiveAdmin,
} from "./delegation";
import { assertDisplayName, assertInternalReturnTo, assertPasswordPolicy, assertRoleCode, normalizeEmail, normalizePhone } from "./identity";
import { assignmentChanged, sessionRevoked } from "./outbox";
import { pageResult, pageWindow, parseIncludeDeleted, parsePageQuery } from "./pagination";
import { assertCanRevokeCredential, assertCounter, policyAfterDisable, policyAfterEnable, policyAfterRegistration } from "./passkey-policy";
import { assertRecoveryCompletionAllowed, restoredUserStatus } from "./recovery-policy";
import { assessRefresh, assessSession } from "./session-policy";

const now = new Date("2026-10-21T18:00:00.000Z");

function user(overrides: Partial<Parameters<typeof assessSession>[0]["user"]> = {}) {
  return { status: "active" as const, deletedAt: null, authorizationVersion: 3, ...overrides };
}

function session(overrides: Partial<Parameters<typeof assessSession>[0]["session"]> = {}) {
  return {
    revokedAt: null,
    expiresAt: "2026-10-21T20:00:00.000Z",
    lastSeenAt: "2026-10-21T17:50:00.000Z",
    authorizationVersion: 3,
    restricted: false,
    ...overrides,
  };
}

describe("acceso domain", () => {
  it("matches the permission catalog file", () => {
    const text = readFileSync(join(__dirname, "../../../../docs/contratos/permisos.yaml"), "utf8");
    const codes = [...text.matchAll(/code: ([a-z0-9:-]+)/g)].map((match) => match[1]);
    expect(codes).toEqual(PERMISSIONS.map((item) => item.code));
    expect(UNASSIGNED_PERMISSIONS).toEqual(["audit:read:own", "offers:read:any"]);
    expect(ROLES.map((role) => role.code)).toEqual(["cliente", "soporte", "auditor", "administrador", "gestor-catalogo"]);
    expect(ROLES.find((role) => role.code === "gestor-catalogo")?.assignableByAccessAdmin).toBe(false);
    expect(DELEGABLE_CUSTOM_ROLE_PERMISSIONS).not.toContain("security:recovery:complete");
    expect(DELEGABLE_CUSTOM_ROLE_PERMISSIONS).not.toContain("ai:documents:read");
  });

  it("rejects self assignment and a non delegable custom role", () => {
    expect(() =>
      assertCanAssignRole("actor", "actor", {
        id: "role",
        code: "cliente",
        system: true,
        assignableByAccessAdmin: true,
        permissions: [],
        deletedAt: null,
      }),
    ).toThrow(AccessError);
    expect(() =>
      assertCanAssignRole("actor", "other", {
        id: "role",
        code: "gestor-catalogo",
        system: true,
        assignableByAccessAdmin: false,
        permissions: ["ai:documents:read"],
        deletedAt: null,
      }),
    ).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => assertCustomRolePermissions(["ai:documents:reindex"])).toThrow(expect.objectContaining({ code: "BUSINESS_RULE" }));
    expect(() =>
      assertCanReplaceRolePermissions({
        actorRoleIds: ["custom"],
        targetRoleId: "custom",
        system: false,
        permissionCodes: ["users:read"],
      }),
    ).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
  });

  it("protects the last effective administrator", () => {
    expect(() => assertKeepsEffectiveAdmin({ effectiveAdminUserIds: ["admin"], removingUserIds: ["admin"] })).toThrow(
      expect.objectContaining({ code: "BUSINESS_RULE" }),
    );
    expect(() =>
      assertKeepsEffectiveAdmin({ effectiveAdminUserIds: ["admin", "other"], removingUserIds: ["admin"] }),
    ).not.toThrow();
  });

  it("rejects a revoked, idle, expired or stale session", () => {
    expect(assessSession({ session: session({ revokedAt: now.toISOString() }), user: user(), now, idleSeconds: 1800 })).toBe(
      "revoked",
    );
    expect(
      assessSession({
        session: session({ lastSeenAt: "2026-10-21T17:00:00.000Z" }),
        user: user(),
        now,
        idleSeconds: 1800,
      }),
    ).toBe("idle");
    expect(
      assessSession({
        session: session({ authorizationVersion: 2 }),
        user: user(),
        now,
        idleSeconds: 1800,
      }),
    ).toBe("version_mismatch");
    expect(assessSession({ session: session(), user: user({ deletedAt: now.toISOString() }), now, idleSeconds: 1800 })).toBe(
      "user_inactive",
    );
  });

  it("treats refresh reuse as a family compromise", () => {
    expect(
      assessRefresh({ usedAt: now.toISOString(), revokedAt: null, expiresAt: "2026-10-21T20:00:00.000Z", now }),
    ).toBe("reuse");
    expect(assessRefresh({ usedAt: null, revokedAt: null, expiresAt: "2026-10-21T20:00:00.000Z", now })).toBe("rotate");
  });

  it("locks an OTP after the attempt budget and rejects an expired code", () => {
    expect(
      assessProof({
        purpose: "email_login",
        expectedPurpose: "email_login",
        expiresAt: "2026-10-21T17:00:00.000Z",
        consumedAt: null,
        invalidatedAt: null,
        attemptCount: 0,
        maxAttempts: 5,
        now,
        proofMatches: true,
      }),
    ).toBe("expired");
    expect(
      assessProof({
        purpose: "email_login",
        expectedPurpose: "email_login",
        expiresAt: "2026-10-21T19:00:00.000Z",
        consumedAt: null,
        invalidatedAt: null,
        attemptCount: 4,
        maxAttempts: 5,
        now,
        proofMatches: false,
      }),
    ).toBe("locked");
    expect(
      assessProof({
        purpose: "email_login",
        expectedPurpose: "email_login",
        expiresAt: "2026-10-21T19:00:00.000Z",
        consumedAt: now.toISOString(),
        invalidatedAt: null,
        attemptCount: 0,
        maxAttempts: 5,
        now,
        proofMatches: true,
      }),
    ).toBe("consumed");
  });

  it("does not disable passkeys by revoking the last credential", () => {
    expect(() => assertCanRevokeCredential("active", 1)).toThrow(expect.objectContaining({ code: "BUSINESS_RULE" }));
    expect(policyAfterRegistration("pending")).toBe("active");
    expect(assertCounter(0, 0)).toBe(0);
    expect(() => assertCounter(4, 4)).toThrow(expect.objectContaining({ code: "CHALLENGE_INVALID" }));
  });

  it("keeps administrative recovery closed and distinct actors explicit", () => {
    expect(() => assertRecoveryCompletionAllowed("a", "b")).toThrow(expect.objectContaining({ code: "RECOVERY_POLICY_DISABLED" }));
    expect(() => assertRecoveryCompletionAllowed("a", "a", true)).toThrow(expect.objectContaining({ code: "BUSINESS_RULE" }));
    expect(restoredUserStatus()).toBe("disabled");
  });

  it("denies a restricted session and fails closed when the database is down", () => {
    expect(
      decideAuthorization({
        databaseAvailable: true,
        verdict: "valid",
        restricted: true,
        permission: "transfers:create:own",
        granted: new Set(["transfers:create:own"]),
      }),
    ).toEqual({ decision: "deny", reasonCode: "restricted_session" });
    expect(() =>
      decideAuthorization({
        databaseAvailable: false,
        verdict: "valid",
        restricted: false,
        permission: "users:read",
        granted: new Set(["users:read"]),
      }),
    ).toThrow(expect.objectContaining({ code: "DEPENDENCY_UNAVAILABLE" }));
  });

  it("parses deleted filters without treating the string false as true", () => {
    expect(parseIncludeDeleted("false")).toBe(false);
    expect(parseIncludeDeleted("true")).toBe(true);
    expect(() => parseIncludeDeleted("no")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(parsePageQuery({ page: "2", pageSize: "20", sort: "createdAt", pageDefault: 20, pageMax: 100 }).page).toBe(2);
    expect(normalizeEmail(" Ana@Portal.Local ")).toBe("ana@portal.local");
    expect(normalizePhone("MX", "5512345678").e164).toBe("+525512345678");
    expect(() => assertInternalReturnTo("https://evil.example")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(sessionRevoked("s", "u", "logout").payload).not.toHaveProperty("token");
    expect(assignmentChanged("u", "r", "a", "revoked").eventType).toBe("role.assignment.changed");
  });

  it("maps each public error code to an HTTP status", () => {
    for (const code of ACCESS_ERROR_CODES) {
      expect(httpStatusFor(code)).toBeGreaterThanOrEqual(400);
    }
    expect(() => normalizePhone("US", "5512345678")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => assertPasswordPolicy("short", 12)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => assertPasswordPolicy("   ", 1)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => assertDisplayName(" ", "givenName")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => assertRoleCode("Rol Admin")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(assertInternalReturnTo("")).toBe("/");
    expect(pageWindow(2, 20)).toEqual({ offset: 20, limit: 20 });
    expect(pageResult([], 0, 1, 20).totalPages).toBe(0);
    expect(() => parsePageQuery({ pageSize: "101", pageDefault: 20, pageMax: 100 })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => parsePageQuery({ sort: "name", pageDefault: 20, pageMax: 100 })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => parsePageQuery({ status: "ghost", pageDefault: 20, pageMax: 100 })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => parsePageQuery({ page: "0", pageDefault: 20, pageMax: 100 })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(policyAfterEnable("active", 0)).toBe("active");
    expect(policyAfterEnable("pending", 1)).toBe("active");
    expect(policyAfterRegistration("pending")).toBe("active");
    expect(() => policyAfterRegistration("disabled")).toThrow(expect.objectContaining({ code: "BUSINESS_RULE" }));
    expect(policyAfterDisable("disabled")).toBe("disabled");
    expect(assertCounter(0, 0)).toBe(0);
    expect(assertCounter(1, 2)).toBe(2);
    expect(sessionInvalid("expired")).toBe(true);
    expect(decideAuthorization({ databaseAvailable: true, verdict: "valid", restricted: true, permission: "users:read", granted: new Set(["users:read"]) }).reasonCode).toBe("restricted_session");
    expect(decideAuthorization({ databaseAvailable: true, verdict: "valid", restricted: false, permission: "users:read", granted: new Set() }).reasonCode).toBe("permission");
  });
});
