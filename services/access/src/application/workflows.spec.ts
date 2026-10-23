import { AccessError } from "../domain/access-error";
import type { UserRecord } from "../domain/records";
import { renderSecurityEmail } from "./security-email";
import { AuthWorkflows, type AuthDependencies } from "./auth-workflows";
import { DirectoryWorkflows } from "./directory-workflows";
import type { AuthLimits } from "./ports";
import { MemoryAccessStore } from "./testing/memory-store";

const limits: AuthLimits = {
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

function user(id: string, email: string): UserRecord {
  return {
    id,
    email,
    emailNormalized: email,
    emailVerifiedAt: "2026-10-21T12:00:00.000Z",
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
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
    deletedAt: null,
    deletedBy: null,
  };
}

function harness(now = new Date("2026-10-21T18:00:00.000Z"), overrides: Partial<AuthDependencies> = {}) {
  const store = new MemoryAccessStore();
  const sent: string[] = [];
  let sequence = 0;
  const deps: AuthDependencies = {
    store,
    passwords: {
      async hash(password) {
        return `hash:${password}`;
      },
      async verify(password, passwordHash) {
        return passwordHash === `hash:${password}`;
      },
    },
    codes: {
      protect(binding, code) {
        return `${binding}:${code}`;
      },
      same(left, right) {
        return left === right;
      },
    },
    mailer: {
      async send(message) {
        sent.push(message.text);
      },
    },
    tokens: {
      async sign(input) {
        return `jwt:${input.sessionId}:${input.authorizationVersion}:${input.restricted}`;
      },
      async verify(token) {
        const [, sessionId, version, restricted] = token.split(":");
        const session = await store.findSession(sessionId ?? "");
        if (!session) {
          return null;
        }
        return {
          userId: session.userId,
          sessionId: session.id,
          authorizationVersion: Number(version),
          restricted: restricted === "true",
        };
      },
    },
    webauthn: {
      configured: () => true,
      async registrationOptions() {
        return { challenge: "register" };
      },
      async verifyRegistration() {
        return { credentialId: "cred", publicKey: "pub", signCount: 0, transports: [], deviceType: "multiDevice", backedUp: true };
      },
      async authenticationOptions() {
        return { challenge: "login" };
      },
      async verifyAuthentication(input) {
        return input.response.tampered === true ? null : { signCount: input.signCount };
      },
    },
    oidc: {
      configured: () => false,
      start: () => "https://idp.example/auth",
      async exchange() {
        return "invalid";
      },
    },
    rates: {
      async hit() {
        return "ok";
      },
    },
    random: {
      uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      token: () => `token-${++sequence}`,
      digits: () => "123456",
    },
    clock: { now: () => now },
    limits,
    portalUrl: "http://localhost:8080",
    ...overrides,
  };
  return { store, sent, auth: new AuthWorkflows(deps), deps };
}

describe("access workflows", () => {
  it("starts an email challenge and rejects a reused refresh", async () => {
    const { store, sent, auth } = harness();
    const account = user("user-1", "ana@portal.local");
    await store.saveUser(account);
    await store.savePassword({ id: "pw", userId: account.id, passwordHash: "hash:correct-password", changedAt: account.createdAt, revokedAt: null });
    const step = await auth.login(account.email, "correct-password", "127.0.0.1");
    expect(step.nextStep).toBe("EMAIL_CHALLENGE");
    expect(sent[0]).toContain("123456");
    const verified = await auth.verifyEmail(step.challengeId ?? "", "123456");
    expect(verified.nextStep).toBe("AUTHENTICATED");
    const refresh = verified.session?.refreshToken ?? "";
    await auth.refresh(refresh);
    await expect(auth.refresh(refresh)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    expect(store.outbox.some((event) => event.payload.reason === "refresh_reuse")).toBe(true);
  });

  it("does not authenticate an altered passkey or a replayed challenge", async () => {
    const { store, auth } = harness();
    const account = user("user-2", "bruno@portal.local");
    await store.saveUser(account);
    await store.savePasskeyPolicy({ userId: account.id, status: "active", enabledAt: account.createdAt, activatedAt: account.createdAt });
    await store.savePasskey({
      id: "pk",
      userId: account.id,
      credentialId: "cred",
      publicKey: "pub",
      signCount: 0,
      transports: [],
      name: "Passkey",
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: account.createdAt,
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
    });
    await store.savePassword({ id: "pw", userId: account.id, passwordHash: "hash:correct-password", changedAt: account.createdAt, revokedAt: null });
    const step = await auth.login(account.email, "correct-password", "127.0.0.1");
    expect(step.nextStep).toBe("PASSKEY_CHALLENGE");
    await expect(auth.verifyPasskey(step.challengeId ?? "", { id: "cred", tampered: true })).rejects.toBeInstanceOf(AccessError);
    const accepted = await auth.verifyPasskey(step.challengeId ?? "", { id: "cred" });
    expect(accepted.nextStep).toBe("AUTHENTICATED");
    await expect(auth.verifyPasskey(step.challengeId ?? "", { id: "cred" })).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
  });

  it("blocks self assignment, the last administrator and unsafe restore", async () => {
    const { store, auth, deps } = harness();
    const directory = new DirectoryWorkflows(store, deps.random, deps.clock, deps.codes, deps.mailer, deps.portalUrl, limits.emailCodeTtl);
    const admin = user("admin", "diego@portal.local");
    const other = user("other", "elena@portal.local");
    await store.saveUser(admin);
    await store.saveUser(other);
    await store.saveRole({
      id: "admin-role",
      applicationId: "portal",
      code: "administrador",
      name: "Administrador",
      description: "",
      system: true,
      assignableByAccessAdmin: true,
      version: 1,
      permissions: ["users:roles:assign", "users:delete"],
      createdAt: admin.createdAt,
      deletedAt: null,
    });
    await store.saveAssignment({
      id: "assignment",
      userId: admin.id,
      roleId: "admin-role",
      assignedBy: "seed",
      expiresAt: null,
      createdAt: admin.createdAt,
      deletedAt: null,
      deletedBy: null,
    });
    await expect(directory.assignRole(admin.id, admin.id, "admin-role", null)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(directory.deleteUser(other.id, admin.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await store.savePassword({ id: "old", userId: other.id, passwordHash: "hash:old-password-1", changedAt: other.createdAt, revokedAt: null });
    await directory.deleteUser(admin.id, other.id);
    const restored = await directory.restoreUser(other.id);
    expect(restored.status).toBe("disabled");
    expect(await store.activePassword(other.id)).toBeNull();
    await expect(auth.completeRecovery("missing", admin.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    const request = await directory.initiateRecovery(admin.id, other.id, "perdió la passkey");
    await expect(auth.completeRecovery(request.id, admin.id)).rejects.toMatchObject({ code: "RECOVERY_POLICY_DISABLED" });
  });

  it("rejects an unconfigured OIDC provider instead of inventing a login", async () => {
    const { auth } = harness();
    await expect(auth.startOidc("google", "login", null, "/")).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("resets a password without revealing whether the mailbox exists", async () => {
    const { store, sent, auth } = harness();
    const account = user("user-3", "carla@portal.local");
    await store.saveUser(account);
    await store.savePassword({ id: "pw", userId: account.id, passwordHash: "hash:old-password-12", changedAt: account.createdAt, revokedAt: null });
    await auth.forgotPassword("missing@portal.local");
    expect(sent).toHaveLength(0);
    await auth.forgotPassword(account.email);
    const code = sent[0]?.match(/Código: (\S+)/)?.[1] ?? "";
    await auth.resetPassword(code, "new-password-12");
    expect((await store.activePassword(account.id))?.passwordHash).toBe("hash:new-password-12");
    await expect(auth.resetPassword(code, "new-password-12")).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
  });

  it("revokes the family on logout and requires a recent session to rotate recovery codes", async () => {
    const { store, auth } = harness();
    const account = user("user-4", "diego@portal.local");
    await store.saveUser(account);
    await store.savePassword({ id: "pw", userId: account.id, passwordHash: "hash:correct-password", changedAt: account.createdAt, revokedAt: null });
    const step = await auth.verifyEmail((await auth.login(account.email, "correct-password", "10.0.0.8")).challengeId ?? "", "123456");
    const sessionId = step.session?.session.id ?? "";
    await auth.logout(sessionId);
    expect((await store.findSession(sessionId))?.revokedAt).not.toBeNull();
    await expect(auth.currentSession("jwt:missing:1:false")).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(auth.changePassword(account.id, "wrong-password", "another-password")).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects a custom role with a catalog permission and a stale permission version", async () => {
    const { store, deps } = harness();
    const directory = new DirectoryWorkflows(store, deps.random, deps.clock, deps.codes, deps.mailer, deps.portalUrl, limits.emailCodeTtl);
    const admin = user("admin-2", "admin2@portal.local");
    await store.saveUser(admin);
    await store.saveApplication({ id: "app", code: "portal", name: "Portal", description: "", status: "active", createdAt: admin.createdAt, deletedAt: null });
    await expect(directory.createRole("app", { code: "operador", name: "Operador", permissionCodes: ["ai:documents:read"] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const role = await directory.createRole("app", { code: "operador", name: "Operador", permissionCodes: ["users:read"] });
    await expect(directory.replacePermissions(admin.id, role.id, 9, ["users:read"])).rejects.toMatchObject({ code: "CONFLICT" });
    await directory.assignRole(admin.id, (await directory.invite(admin.id, { email: "nuevo@portal.local", givenName: "Nuevo", familyName: "Usuario" })).id, role.id, null);
    await expect(directory.listUsers(["users:read"], { page: 1, pageSize: 20, sort: "-createdAt", includeDeleted: true })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(directory.updateProfile(admin, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const renamed = await directory.updateProfile(admin, { givenName: "Diego", themePreference: "dark" });
    expect(renamed.themePreference).toBe("dark");
  });

  it("rejects an altered OIDC token and a replayed state", async () => {
    const { auth, store } = harness(new Date("2026-10-21T18:00:00.000Z"), {
      oidc: {
        configured: () => true,
        start: () => "https://idp.example/auth",
        async exchange(input) {
          return input.code === "tampered" ? "invalid" : { issuer: "https://accounts.google.com", subject: "sub-1", audience: "client", nonce: input.nonce, email: "ana@portal.local" };
        },
      },
    });
    const url = await auth.startOidc("google", "login", null, "/");
    expect(url).toContain("https://idp.example");
    const state = "token-1";
    await expect(auth.completeOidc("google", "tampered", state)).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
    await expect(auth.completeOidc("google", "tampered", state)).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
    expect(store.oidc[0]?.consumedAt).not.toBeNull();
  });

  it("covers enrollment, recovery codes, permission checks and mail failure", async () => {
    const { store, auth, deps } = harness();
    const account = user("user-5", "elena@portal.local");
    await store.saveUser(account);
    await store.savePassword({ id: "pw", userId: account.id, passwordHash: "hash:correct-password", changedAt: account.createdAt, revokedAt: null });
    await store.savePasskeyPolicy({ userId: account.id, status: "pending", enabledAt: account.createdAt, activatedAt: null });
    const step = await auth.login(account.email, "correct-password", "10.1.1.1");
    expect(step.nextStep).toBe("PASSKEY_ENROLLMENT_REQUIRED");
    const current = await auth.currentSession(step.session?.accessToken);
    expect(current.permissions).toEqual([]);
    const enrollment = await auth.registrationOptions(account.id, true);
    await auth.verifyRegistration(account.id, enrollment.challengeId ?? "", {});
    await expect(auth.revokePasskey(account.id, (await store.activePasskeys(account.id))[0]?.id ?? "")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const codes = await auth.regenerateRecoveryCodes(account.id);
    expect(codes).toHaveLength(10);
    await auth.changePassword(account.id, "correct-password", "changed-password");
    await auth.logoutAll(account.id);
    await expect(auth.assertPermission(["users:read"], "users:delete")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const failing = harness(new Date("2026-10-21T18:00:00.000Z"), {
      mailer: { async send() { throw new Error("smtp down"); } },
      rates: { async hit() { return "ok"; } },
    });
    const mailbox = user("user-6", "correo@portal.local");
    await failing.store.saveUser(mailbox);
    await failing.store.savePassword({ id: "pw2", userId: mailbox.id, passwordHash: "hash:correct-password", changedAt: mailbox.createdAt, revokedAt: null });
    await expect(failing.auth.login(mailbox.email, "correct-password", "10.2.2.2")).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    const limited = harness(new Date("2026-10-21T18:00:00.000Z"), { rates: { async hit() { return "limited"; } } });
    await expect(limited.auth.login("ana@portal.local", "correct-password", "10.3.3.3")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const directory = new DirectoryWorkflows(store, deps.random, deps.clock, deps.codes, deps.mailer, "http://localhost:8080", 300);
    await directory.configurePasskey(account.id, account.id, "disable");
    await expect(directory.deleteRole("missing")).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    expect((await directory.updateProfile(account, { phoneCountryCode: "MX", phoneNumber: "5512345678" })).phoneE164).toBe("+525512345678");
  });

  it("covers resend, wrong codes, missing refresh and role deletion", async () => {
    const { store, auth, sent, deps } = harness();
    await expect(auth.login("sin-arroba", "password", "10.9.9.9")).rejects.toMatchObject({ code: "SESSION_INVALID" });
    const account = user("user-7", "rama@portal.local");
    await store.saveUser(account);
    await store.savePassword({ id: "pw", userId: account.id, passwordHash: "hash:correct-password", changedAt: account.createdAt, revokedAt: null });
    const first = await auth.login(account.email, "nope", "10.9.9.1").catch((error: unknown) => error);
    expect(first).toMatchObject({ code: "SESSION_INVALID" });
    const step = await auth.login(account.email, "correct-password", "10.9.9.2");
    const resent = await auth.resendEmail(step.challengeId ?? "");
    await expect(auth.verifyEmail(resent.challengeId ?? "", "000000")).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
    await expect(auth.refresh("missing-token")).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await store.savePasskeyPolicy({ userId: account.id, status: "active", enabledAt: account.createdAt, activatedAt: account.createdAt });
    await store.savePasskey({
      id: "pk-rama", userId: account.id, credentialId: "cred", publicKey: "pub", signCount: 1, transports: ["internal"],
      name: "Llave", deviceType: "singleDevice", backedUp: false, createdAt: account.createdAt, lastUsedAt: null, revokedAt: null, revokedBy: null,
    });
    const passkey = await auth.login(account.email, "correct-password", "10.9.9.3");
    const options = await auth.passkeyOptions(passkey.challengeId ?? "");
    expect(options.options).toBeDefined();
    await store.saveRecoveryCode({ id: "rc", userId: account.id, codeHash: "user-7:backup", usedAt: null, revokedAt: null });
    const restricted = await auth.verifyRecoveryCode(passkey.challengeId ?? "", "backup");
    expect(restricted.nextStep).toBe("RECOVERY_RESTRICTED");
    const directory = new DirectoryWorkflows(store, deps.random, deps.clock, deps.codes, deps.mailer, "http://localhost:8080", 300);
    const role = await directory.createRole("portal-app", { code: "consulta", name: "Consulta", permissionCodes: ["users:read"] });
    await store.saveApplication({ id: "portal-app", code: "portal", name: "Portal", description: "", status: "active", createdAt: account.createdAt, deletedAt: null });
    await expect(directory.deleteRole(role.id)).resolves.toBeUndefined();
    await expect(directory.updateUser(account.id, account.id, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(directory.restoreUser(account.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sent.some((message) => message.includes("Código"))).toBe(true);
    expect(renderSecurityEmail({ to: "a@b.co", title: `A&B<C>D"E'F`, code: "1", expiresMinutes: 5, portalUrl: "http://localhost:8080", purpose: "aviso" }).html).toContain("&amp;");
    expect((await auth.registrationOptions(account.id, false)).nextStep).toBe("PASSKEY_ENROLLMENT_REQUIRED");
  });

  it("keeps application restore disabled and caches permissions by version", async () => {
    const cached: string[][] = [];
    const { store, auth, deps } = harness(new Date("2026-10-21T18:00:00.000Z"), {
      cache: {
        async get() {
          return cached[0] ?? null;
        },
        async set(_key: string, permissions: string[]) {
          cached[0] = permissions;
        },
      },
    });
    const account = user("user-8", "cache@portal.local");
    await store.saveUser(account);
    await store.savePassword({ id: "pw", userId: account.id, passwordHash: "hash:correct-password", changedAt: account.createdAt, revokedAt: null });
    const step = await auth.verifyEmail((await auth.login(account.email, "correct-password", "10.8.8.8")).challengeId ?? "", "123456");
    const first = await auth.currentSession(step.session?.accessToken);
    const second = await auth.currentSession(step.session?.accessToken);
    expect(second.permissions).toEqual(first.permissions);
    const directory = new DirectoryWorkflows(store, deps.random, deps.clock, deps.codes, deps.mailer, "http://localhost:8080", 300);
    const application = await directory.createApplication({ code: "cobros", name: "Cobros" });
    expect((await directory.updateApplication(application.id, { name: "Cobros locales", status: "disabled" })).name).toBe("Cobros locales");
    expect((await directory.listApplications(["applications:read"], { page: 1, pageSize: 20, sort: "-createdAt", includeDeleted: false })).totalItems).toBe(1);
    const role = await directory.createRole(application.id, { code: "consulta", name: "Consulta", permissionCodes: ["users:read"] });
    expect((await directory.updateRole(role.id, { name: "Consulta local" })).name).toBe("Consulta local");
    await directory.deleteRole(role.id);
    expect((await directory.restoreRole(role.id)).deletedAt).toBeNull();
    await directory.deleteApplication(application.id);
    expect((await directory.restoreApplication(application.id)).status).toBe("disabled");
    expect((await directory.listSessions(account.id, { page: 1, pageSize: 20, sort: "-createdAt", includeDeleted: false })).totalItems).toBeGreaterThan(0);
    expect(directory.listPermissions().some((item) => item.code === "users:read")).toBe(true);
  });
});
