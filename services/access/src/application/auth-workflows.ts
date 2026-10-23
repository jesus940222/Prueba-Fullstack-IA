import { createHash } from "node:crypto";
import { AccessError } from "../domain/access-error";
import { assessProof, nextAttemptCount } from "../domain/challenge-policy";
import { assertPasswordPolicy, normalizeEmail } from "../domain/identity";
import { sessionRevoked } from "../domain/outbox";
import { assertCanRevokeCredential, assertCounter, policyAfterRegistration } from "../domain/passkey-policy";
import type { ChallengeRecord, RefreshRecord, SessionRecord, UserRecord } from "../domain/records";
import { assertRecoveryCompletionAllowed, restoredUserStatus } from "../domain/recovery-policy";
import { assessRefresh, assessSession, isRecentlyVerified, sessionExpiry } from "../domain/session-policy";
import type { AccessStore } from "./access-store";
import type {
  AccessTokenIssuer,
  AuthLimits,
  Clock,
  Mailer,
  OneTimeCode,
  OidcProvider,
  PasswordHasher,
  RandomSource,
  PermissionCache,
  RateLimiter,
  WebAuthnCeremony,
} from "./ports";
import { renderSecurityEmail } from "./security-email";

export interface AuthStepResult {
  nextStep: "EMAIL_CHALLENGE" | "PASSKEY_CHALLENGE" | "PASSKEY_ENROLLMENT_REQUIRED" | "RECOVERY_RESTRICTED" | "AUTHENTICATED";
  challengeId?: string;
  expiresAt?: string;
  options?: Record<string, unknown>;
  codes?: string[];
  session?: IssuedSession;
}

export interface IssuedSession {
  session: SessionRecord;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

export interface AuthDependencies {
  store: AccessStore;
  passwords: PasswordHasher;
  codes: OneTimeCode;
  mailer: Mailer;
  tokens: AccessTokenIssuer;
  webauthn: WebAuthnCeremony;
  oidc: OidcProvider;
  rates: RateLimiter;
  random: RandomSource;
  clock: Clock;
  limits: AuthLimits;
  portalUrl: string;
  cache?: PermissionCache;
}

const GENERIC_LOGIN = "Correo o contraseña incorrectos";

export class AuthWorkflows {
  constructor(private readonly deps: AuthDependencies) {}

  async login(emailInput: string, password: string, ip: string): Promise<AuthStepResult> {
    await this.limit(`ip:${hash(ip)}`, this.deps.limits.loginIpFailures);
    const email = safeEmail(emailInput);
    await this.limit(`account:${hash(email)}`, this.deps.limits.loginAccountFailures);
    const user = await this.deps.store.findUserByEmail(email);
    const stored = user ? await this.deps.store.activePassword(user.id) : null;
    const matches = stored ? await this.deps.passwords.verify(password, stored.passwordHash) : false;
    if (!user || user.deletedAt !== null || user.status !== "active" || !stored || !matches) {
      throw new AccessError("SESSION_INVALID", GENERIC_LOGIN);
    }
    return this.continueAuthentication(user);
  }

  async resendEmail(challengeId: string): Promise<AuthStepResult> {
    await this.limit(`resend:${challengeId}`, this.deps.limits.resendLimit);
    const current = await this.requireChallenge(challengeId);
    const user = await this.requireUser(current.userId);
    const now = this.deps.clock.now().toISOString();
    await this.deps.store.invalidateChallenges(user.id, "email_login", now);
    return this.emailChallenge(user);
  }

  async verifyEmail(challengeId: string, proof: string): Promise<AuthStepResult> {
    const verdict = await this.consumeProof(challengeId, "email_login", proof);
    const user = await this.requireUser(verdict.userId);
    if (user.emailVerifiedAt === null) {
      user.emailVerifiedAt = this.deps.clock.now().toISOString();
      user.updatedAt = user.emailVerifiedAt;
      await this.deps.store.saveUser(user);
    }
    return this.continueAuthentication(user, true);
  }

  async passkeyOptions(challengeId: string): Promise<AuthStepResult> {
    if (!this.deps.webauthn.configured()) {
      throw new AccessError("DEPENDENCY_UNAVAILABLE", "WebAuthn no está configurado");
    }
    const challenge = await this.requireChallenge(challengeId);
    if (challenge.purpose !== "passkey_login" || challenge.consumedAt !== null) {
      throw new AccessError("CHALLENGE_INVALID", "El desafío no admite passkey");
    }
    const credentials = await this.deps.store.activePasskeys(challenge.userId);
    const options = await this.deps.webauthn.authenticationOptions({
      challenge: challenge.binding,
      credentialIds: credentials.map((item) => item.credentialId),
    });
    return { nextStep: "PASSKEY_CHALLENGE", challengeId, options };
  }

  async verifyPasskey(challengeId: string, response: Record<string, unknown>): Promise<AuthStepResult> {
    const challenge = await this.requireChallenge(challengeId);
    if (challenge.purpose !== "passkey_login") {
      throw new AccessError("CHALLENGE_INVALID", "El desafío no admite passkey");
    }
    const credentials = await this.deps.store.activePasskeys(challenge.userId);
    const credentialId = typeof response.id === "string" ? response.id : "";
    const credential = credentials.find((item) => item.credentialId === credentialId);
    if (!credential) {
      throw new AccessError("CHALLENGE_INVALID", "La credencial no corresponde al usuario");
    }
    const verified = await this.deps.webauthn.verifyAuthentication({
      challenge: challenge.binding,
      response,
      credentialId: credential.credentialId,
      publicKey: credential.publicKey,
      signCount: credential.signCount,
      transports: credential.transports,
    });
    if (!verified) {
      throw new AccessError("CHALLENGE_INVALID", "La passkey no es válida");
    }
    const consumed = await this.consumeBinding(challenge);
    if (!consumed) {
      throw new AccessError("CHALLENGE_INVALID", "El desafío ya fue utilizado");
    }
    credential.signCount = assertCounter(credential.signCount, verified.signCount);
    credential.lastUsedAt = this.deps.clock.now().toISOString();
    await this.deps.store.savePasskey(credential);
    const user = await this.requireUser(challenge.userId);
    return this.issue(user, "passkey", false);
  }

  async verifyRecoveryCode(challengeId: string, proof: string): Promise<AuthStepResult> {
    const challenge = await this.requireChallenge(challengeId);
    if (challenge.purpose !== "email_login" && challenge.purpose !== "passkey_login") {
      throw new AccessError("CHALLENGE_INVALID", "El código de recuperación no corresponde a este desafío");
    }
    const codeHash = this.deps.codes.protect(challenge.userId, proof);
    const consumed = await this.deps.store.consumeRecoveryCode(challenge.userId, codeHash, this.deps.clock.now().toISOString());
    if (!consumed) {
      throw new AccessError("CHALLENGE_INVALID", "El código de recuperación no es válido");
    }
    await this.consumeBinding(challenge);
    const user = await this.requireUser(challenge.userId);
    const issued = await this.issue(user, "recovery_code", true);
    return { ...issued, nextStep: "RECOVERY_RESTRICTED" };
  }

  async forgotPassword(emailInput: string): Promise<void> {
    const email = safeEmail(emailInput);
    const user = await this.deps.store.findUserByEmail(email);
    if (!user || user.deletedAt !== null) {
      return;
    }
    const token = this.deps.random.token(32);
    const now = this.deps.clock.now();
    await this.deps.store.saveChallenge({
      id: this.deps.random.uuid(),
      userId: user.id,
      purpose: "password_reset",
      verifierHash: this.deps.codes.protect("password_reset", token),
      attemptCount: 0,
      expiresAt: new Date(now.getTime() + this.deps.limits.emailCodeTtl * 1000).toISOString(),
      consumedAt: null,
      invalidatedAt: null,
      binding: "password_reset",
    });
    await this.deps.mailer.send(renderSecurityEmail({
      to: user.email,
      title: "Restablece tu contraseña",
      code: token,
      expiresMinutes: Math.round(this.deps.limits.emailCodeTtl / 60),
      portalUrl: this.deps.portalUrl,
      purpose: "Usa el código una sola vez en el formulario de restablecimiento. No lo reenvíes.",
    }));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    assertPasswordPolicy(password, this.deps.limits.passwordMinLength);
    const matched = await this.findReset(token);
    const owner = matched ? await this.deps.store.findUserById(matched.userId) : null;
    if (!matched || !owner || owner.deletedAt !== null) {
      throw new AccessError("CHALLENGE_INVALID", "El enlace de restablecimiento no es válido");
    }
    const verdict = assessProof({
      purpose: matched.purpose,
      expectedPurpose: matched.purpose,
      expiresAt: matched.expiresAt,
      consumedAt: matched.consumedAt,
      invalidatedAt: matched.invalidatedAt,
      attemptCount: matched.attemptCount,
      maxAttempts: 1,
      now: this.deps.clock.now(),
      proofMatches: true,
    });
    if (verdict !== "accepted") {
      throw new AccessError("CHALLENGE_INVALID", "El enlace de restablecimiento no es válido");
    }
    matched.consumedAt = this.deps.clock.now().toISOString();
    if (!(await this.deps.store.saveChallengeState(matched))) {
      throw new AccessError("CHALLENGE_INVALID", "El enlace de restablecimiento no es válido");
    }
    await this.replacePassword(owner, password, matched.purpose === "invitation");
  }

  async refresh(refreshToken: string): Promise<IssuedSession> {
    const now = this.deps.clock.now();
    const consumed = await this.deps.store.consumeRefresh(hash(refreshToken), now.toISOString());
    if (consumed.status === "missing") {
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    if (consumed.status === "used") {
      await this.deps.store.revokeRefreshFamily(consumed.token.familyId, now.toISOString());
      const session = await this.deps.store.revokeSession(consumed.token.sessionId, now.toISOString(), "refresh_reuse");
      if (session) {
        await this.enqueue(sessionRevoked(session.id, session.userId, "refresh_reuse"));
      }
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    const verdict = assessRefresh({ ...consumed.token, now });
    if (verdict !== "rotate") {
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    const session = await this.deps.store.findSession(consumed.token.sessionId);
    const user = session ? await this.deps.store.findUserById(session.userId) : null;
    if (!session || !user) {
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    const sessionVerdict = assessSession({ session, user, now, idleSeconds: this.deps.limits.sessionIdleTtl });
    if (sessionVerdict !== "valid") {
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    const csrfToken = this.deps.random.token(32);
    const replacement = this.refreshRecord(session, consumed.token.familyId);
    await this.deps.store.noteRefreshReplacement(consumed.token.id, replacement.id);
    await this.deps.store.saveRefresh(replacement);
    session.lastSeenAt = now.toISOString();
    session.csrfHash = hash(csrfToken);
    await this.deps.store.saveSession(session);
    const accessToken = await this.deps.tokens.sign(this.claims(session));
    return { session, accessToken, refreshToken: replacement.raw, csrfToken };
  }

  async logout(sessionId: string): Promise<void> {
    const now = this.deps.clock.now().toISOString();
    const session = await this.deps.store.revokeSession(sessionId, now, "logout");
    if (session) {
      await this.enqueue(sessionRevoked(session.id, session.userId, "logout"));
    }
  }

  async logoutAll(userId: string): Promise<void> {
    const now = this.deps.clock.now().toISOString();
    const sessions = await this.deps.store.revokeUserSessions(userId, now, "logout_all");
    for (const session of sessions) {
      await this.enqueue(sessionRevoked(session.id, session.userId, "logout_all"));
    }
  }

  async registrationOptions(userId: string, restricted: boolean): Promise<AuthStepResult> {
    await this.assertRecentOrRestricted(userId, restricted);
    if (!this.deps.webauthn.configured()) {
      throw new AccessError("DEPENDENCY_UNAVAILABLE", "WebAuthn no está configurado");
    }
    const user = await this.requireUser(userId);
    const policy = await this.deps.store.passkeyPolicy(userId);
    if (policy.status === "disabled" && !restricted) {
      throw new AccessError("BUSINESS_RULE", "Un administrador debe habilitar la passkey");
    }
    const existing = await this.deps.store.activePasskeys(userId);
    const binding = this.deps.random.token(32);
    const challenge: ChallengeRecord = {
      id: this.deps.random.uuid(),
      userId,
      purpose: "passkey_enrollment",
      verifierHash: hash(binding),
      attemptCount: 0,
      expiresAt: new Date(this.deps.clock.now().getTime() + this.deps.limits.emailCodeTtl * 1000).toISOString(),
      consumedAt: null,
      invalidatedAt: null,
      binding,
    };
    await this.deps.store.saveChallenge(challenge);
    const options = await this.deps.webauthn.registrationOptions({
      userId,
      userName: user.email,
      challenge: binding,
      excludeCredentialIds: existing.map((item) => item.credentialId),
    });
    return { nextStep: "PASSKEY_ENROLLMENT_REQUIRED", challengeId: challenge.id, options };
  }

  async verifyRegistration(userId: string, challengeId: string, response: Record<string, unknown>): Promise<void> {
    const challenge = await this.requireChallenge(challengeId);
    if (challenge.userId !== userId || challenge.purpose !== "passkey_enrollment") {
      throw new AccessError("CHALLENGE_INVALID", "El alta no corresponde a la sesión");
    }
    const verified = await this.deps.webauthn.verifyRegistration({ challenge: challenge.binding, response });
    if (!verified) {
      throw new AccessError("CHALLENGE_INVALID", "La passkey no es válida");
    }
    if (!(await this.consumeBinding(challenge))) {
      throw new AccessError("CHALLENGE_INVALID", "El desafío ya fue utilizado");
    }
    const now = this.deps.clock.now().toISOString();
    await this.deps.store.savePasskey({
      id: this.deps.random.uuid(),
      userId,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      signCount: verified.signCount,
      transports: verified.transports,
      name: "Passkey",
      deviceType: verified.deviceType,
      backedUp: verified.backedUp,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
    });
    const policy = await this.deps.store.passkeyPolicy(userId);
    if (policy.status === "disabled") {
      throw new AccessError("BUSINESS_RULE", "Un administrador debe habilitar la passkey");
    }
    policy.status = policyAfterRegistration(policy.status);
    policy.activatedAt = now;
    await this.deps.store.savePasskeyPolicy(policy);
    await this.revokeSecurity(userId, "passkey_registered");
  }

  async currentSession(token: string | undefined): Promise<{ session: SessionRecord; user: UserRecord; permissions: string[] }> {
    if (!token) {
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    const claims = await this.deps.tokens.verify(token);
    if (!claims) {
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    let session: SessionRecord | null;
    let user: UserRecord | null;
    try {
      session = await this.deps.store.findSession(claims.sessionId);
      user = session ? await this.deps.store.findUserById(session.userId) : null;
    } catch {
      throw new AccessError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión");
    }
    if (!session || !user || session.userId !== claims.userId) {
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    const verdict = assessSession({ session, user, now: this.deps.clock.now(), idleSeconds: this.deps.limits.sessionIdleTtl });
    if (verdict !== "valid" || session.authorizationVersion !== claims.authorizationVersion) {
      throw new AccessError("SESSION_INVALID", "La sesión no es válida");
    }
    session.lastSeenAt = this.deps.clock.now().toISOString();
    await this.deps.store.saveSession(session);
    const permissions = session.restricted ? [] : await this.cachedPermissions(user, session.lastSeenAt);
    return { session, user, permissions };
  }

  private async cachedPermissions(user: UserRecord, now: string): Promise<string[]> {
    const key = `${user.id}:${user.authorizationVersion}`;
    const cached = this.deps.cache ? await this.deps.cache.get(key) : null;
    if (cached) {
      return cached;
    }
    const permissions = await this.deps.store.permissionsFor(user.id, now);
    if (this.deps.cache) {
      await this.deps.cache.set(key, permissions, this.deps.limits.accessTokenTtl);
    }
    return permissions;
  }

  async assertPermission(permissions: readonly string[], permission: string): Promise<void> {
    if (!permissions.includes(permission)) {
      throw new AccessError("PERMISSION_DENIED", "No tienes permiso para esta operación");
    }
  }

  async assertRecent(session: SessionRecord): Promise<void> {
    if (!isRecentlyVerified(session.verifiedAt, this.deps.clock.now(), this.deps.limits.recentVerificationTtl)) {
      throw new AccessError("RECENT_VERIFICATION_REQUIRED", "Vuelve a iniciar sesión para continuar");
    }
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
    assertPasswordPolicy(nextPassword, this.deps.limits.passwordMinLength);
    const stored = await this.deps.store.activePassword(userId);
    const matches = stored ? await this.deps.passwords.verify(currentPassword, stored.passwordHash) : false;
    if (!matches) {
      throw new AccessError("SESSION_INVALID", "La contraseña actual no es válida");
    }
    const user = await this.requireUser(userId);
    await this.replacePassword(user, nextPassword, false);
  }

  async renamePasskey(userId: string, passkeyId: string, name: string): Promise<void> {
    const passkey = await this.ownedPasskey(userId, passkeyId);
    passkey.name = name.trim();
    await this.deps.store.savePasskey(passkey);
  }

  async revokePasskey(userId: string, passkeyId: string): Promise<void> {
    const passkey = await this.ownedPasskey(userId, passkeyId);
    const policy = await this.deps.store.passkeyPolicy(userId);
    const active = await this.deps.store.activePasskeys(userId);
    assertCanRevokeCredential(policy.status, active.length);
    passkey.revokedAt = this.deps.clock.now().toISOString();
    passkey.revokedBy = userId;
    await this.deps.store.savePasskey(passkey);
    await this.revokeSecurity(userId, "passkey_revoked");
  }

  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const now = this.deps.clock.now().toISOString();
    await this.deps.store.revokeRecoveryCodes(userId, now);
    const codes: string[] = [];
    for (let index = 0; index < this.deps.limits.recoveryCodeCount; index += 1) {
      const code = `${this.deps.random.token(4)}-${this.deps.random.token(4)}`;
      codes.push(code);
      await this.deps.store.saveRecoveryCode({
        id: this.deps.random.uuid(),
        userId,
        codeHash: this.deps.codes.protect(userId, code),
        usedAt: null,
        revokedAt: null,
      });
    }
    await this.revokeSecurity(userId, "recovery_codes_regenerated");
    return codes;
  }

  async startOidc(provider: "google" | "microsoft", intent: "login" | "link", userId: string | null, returnTo: string): Promise<string> {
    if (!this.deps.oidc.configured(provider)) {
      throw new AccessError("DEPENDENCY_UNAVAILABLE", "El proveedor externo no está configurado");
    }
    const state = this.deps.random.token(32);
    const nonce = this.deps.random.token(32);
    const verifier = this.deps.random.token(32);
    const now = this.deps.clock.now();
    await this.deps.store.saveOidc({
      id: this.deps.random.uuid(),
      stateHash: hash(state),
      nonceHash: hash(nonce),
      verifier,
      provider,
      intent,
      userId,
      returnTo,
      expiresAt: new Date(now.getTime() + this.deps.limits.emailCodeTtl * 1000).toISOString(),
      consumedAt: null,
    });
    return this.deps.oidc.start({ provider, state, nonce, verifier, returnTo });
  }

  async completeOidc(provider: "google" | "microsoft", code: string, state: string): Promise<{ returnTo: string; step?: AuthStepResult; linked?: boolean }> {
    const consumed = await this.deps.store.consumeOidc(hash(state), this.deps.clock.now().toISOString());
    if (consumed === "missing" || consumed === "used" || consumed.provider !== provider || Date.parse(consumed.expiresAt) <= this.deps.clock.now().getTime()) {
      throw new AccessError("CHALLENGE_INVALID", "El estado OIDC no es válido");
    }
    const identity = await this.deps.oidc.exchange({ provider, code, verifier: consumed.verifier, nonce: consumed.nonceHash });
    if (identity === "unavailable") {
      throw new AccessError("DEPENDENCY_UNAVAILABLE", "El proveedor externo no respondió");
    }
    if (identity === "invalid" || hash(identity.nonce) !== consumed.nonceHash) {
      throw new AccessError("CHALLENGE_INVALID", "La identidad externa no es válida");
    }
    if (consumed.intent === "link") {
      if (!consumed.userId) {
        throw new AccessError("CHALLENGE_INVALID", "La vinculación no tiene sesión");
      }
      const existing = await this.deps.store.findIdentityBySubject(provider, identity.issuer, identity.subject);
      if (existing && existing.revokedAt === null && existing.userId !== consumed.userId) {
        throw new AccessError("CONFLICT", "La identidad externa ya está vinculada");
      }
      if (!existing || existing.revokedAt !== null) {
        await this.deps.store.saveIdentity({
          id: this.deps.random.uuid(),
          userId: consumed.userId,
          provider,
          issuer: identity.issuer,
          subject: identity.subject,
          linkedAt: this.deps.clock.now().toISOString(),
          revokedAt: null,
        });
      }
      await this.revokeSecurity(consumed.userId, "identity_linked");
      return { returnTo: consumed.returnTo, linked: true };
    }
    const existing = await this.deps.store.findIdentityBySubject(provider, identity.issuer, identity.subject);
    if (!existing || existing.revokedAt !== null) {
      throw new AccessError("CHALLENGE_INVALID", "No hay una identidad vinculada para ese proveedor");
    }
    const user = await this.requireUser(existing.userId);
    if (user.deletedAt !== null || user.status !== "active") {
      throw new AccessError("SESSION_INVALID", GENERIC_LOGIN);
    }
    return { returnTo: consumed.returnTo, step: await this.continueAuthentication(user) };
  }

  async unlinkIdentity(userId: string, identityId: string): Promise<void> {
    const identity = await this.deps.store.findIdentity(identityId);
    if (!identity || identity.userId !== userId || identity.revokedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "La identidad no está disponible");
    }
    const remaining = (await this.deps.store.listIdentities(userId, { page: 1, pageSize: 20, sort: "-createdAt", includeDeleted: false })).totalItems;
    const password = await this.deps.store.activePassword(userId);
    const passkeys = await this.deps.store.activePasskeys(userId);
    if (remaining <= 1 && !password && passkeys.length === 0) {
      throw new AccessError("BUSINESS_RULE", "La cuenta se quedaría sin un acceso utilizable");
    }
    identity.revokedAt = this.deps.clock.now().toISOString();
    await this.deps.store.saveIdentity(identity);
    await this.revokeSecurity(userId, "identity_unlinked");
  }

  async completeRecovery(requestId: string, actorUserId: string): Promise<void> {
    const request = await this.deps.store.findRecoveryRequest(requestId);
    if (!request) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "La solicitud no está disponible");
    }
    assertRecoveryCompletionAllowed(request.initiatorUserId, actorUserId);
  }

  private async continueAuthentication(user: UserRecord, emailAlreadyProved = false): Promise<AuthStepResult> {
    if (!emailAlreadyProved || user.emailVerifiedAt === null) {
      if (user.emailVerifiedAt === null || !emailAlreadyProved) {
        const policy = await this.deps.store.passkeyPolicy(user.id);
        const credentials = await this.deps.store.activePasskeys(user.id);
        if (user.emailVerifiedAt !== null && policy.status === "active" && credentials.length > 0) {
          return this.passkeyChallenge(user);
        }
        if (user.emailVerifiedAt !== null && (policy.status === "pending" || (policy.status === "active" && credentials.length === 0))) {
          const issued = await this.issue(user, "enrollment", true);
          return { ...issued, nextStep: "PASSKEY_ENROLLMENT_REQUIRED" };
        }
        return this.emailChallenge(user);
      }
    }
    const policy = await this.deps.store.passkeyPolicy(user.id);
    const credentials = await this.deps.store.activePasskeys(user.id);
    if (policy.status === "active" && credentials.length > 0) {
      return this.passkeyChallenge(user);
    }
    if (policy.status === "pending" || policy.status === "active") {
      const issued = await this.issue(user, "enrollment", true);
      return { ...issued, nextStep: "PASSKEY_ENROLLMENT_REQUIRED" };
    }
    return this.issue(user, "password", false);
  }

  private async emailChallenge(user: UserRecord): Promise<AuthStepResult> {
    const code = this.deps.random.digits(6);
    const now = this.deps.clock.now();
    const challenge: ChallengeRecord = {
      id: this.deps.random.uuid(),
      userId: user.id,
      purpose: "email_login",
      verifierHash: this.deps.codes.protect(user.id, code),
      attemptCount: 0,
      expiresAt: new Date(now.getTime() + this.deps.limits.emailCodeTtl * 1000).toISOString(),
      consumedAt: null,
      invalidatedAt: null,
      binding: "email",
    };
    await this.deps.store.saveChallenge(challenge);
    try {
      await this.deps.mailer.send(renderSecurityEmail({
        to: user.email,
        title: "Código de acceso",
        code,
        expiresMinutes: Math.round(this.deps.limits.emailCodeTtl / 60),
        portalUrl: this.deps.portalUrl,
        purpose: "Úsalo solo en el portal que lo solicitó.",
      }));
    } catch {
      throw new AccessError("DEPENDENCY_UNAVAILABLE", "No se pudo enviar el correo");
    }
    return { nextStep: "EMAIL_CHALLENGE", challengeId: challenge.id, expiresAt: challenge.expiresAt };
  }

  private async passkeyChallenge(user: UserRecord): Promise<AuthStepResult> {
    const binding = this.deps.random.token(32);
    const challenge: ChallengeRecord = {
      id: this.deps.random.uuid(),
      userId: user.id,
      purpose: "passkey_login",
      verifierHash: hash(binding),
      attemptCount: 0,
      expiresAt: new Date(this.deps.clock.now().getTime() + this.deps.limits.emailCodeTtl * 1000).toISOString(),
      consumedAt: null,
      invalidatedAt: null,
      binding,
    };
    await this.deps.store.saveChallenge(challenge);
    return { nextStep: "PASSKEY_CHALLENGE", challengeId: challenge.id, expiresAt: challenge.expiresAt };
  }

  private async issue(user: UserRecord, method: string, restricted: boolean): Promise<AuthStepResult> {
    const now = this.deps.clock.now();
    const csrfToken = this.deps.random.token(32);
    const refreshToken = this.deps.random.token(32);
    const session: SessionRecord = {
      id: this.deps.random.uuid(),
      userId: user.id,
      applicationCode: "portal",
      authenticationMethod: method,
      verifiedAt: now.toISOString(),
      authorizationVersion: user.authorizationVersion,
      restricted,
      csrfHash: hash(csrfToken),
      createdAt: now.toISOString(),
      expiresAt: sessionExpiry(now, this.deps.limits.sessionAbsoluteTtl),
      lastSeenAt: now.toISOString(),
      revokedAt: null,
      revocationReason: null,
    };
    await this.deps.store.saveSession(session);
    const refresh = this.refreshRecord(session, this.deps.random.uuid(), refreshToken);
    await this.deps.store.saveRefresh(refresh);
    user.lastLoginAt = now.toISOString();
    await this.deps.store.saveUser({ ...user, updatedAt: now.toISOString() });
    const accessToken = await this.deps.tokens.sign(this.claims(session));
    return {
      nextStep: restricted ? "RECOVERY_RESTRICTED" : "AUTHENTICATED",
      session: { session, accessToken, refreshToken, csrfToken },
    };
  }

  private refreshRecord(session: SessionRecord, familyId: string, raw = this.deps.random.token(32)): RefreshRecord & { raw: string } {
    return {
      id: this.deps.random.uuid(),
      sessionId: session.id,
      familyId,
      tokenHash: hash(raw),
      expiresAt: session.expiresAt,
      usedAt: null,
      revokedAt: null,
      replacedById: null,
      raw,
    };
  }

  private claims(session: SessionRecord) {
    return {
      userId: session.userId,
      sessionId: session.id,
      authorizationVersion: session.authorizationVersion,
      restricted: session.restricted,
      expiresAt: new Date(this.deps.clock.now().getTime() + this.deps.limits.accessTokenTtl * 1000).toISOString(),
    };
  }

  private async consumeProof(challengeId: string, purpose: ChallengeRecord["purpose"], proof: string): Promise<ChallengeRecord> {
    const challenge = await this.requireChallenge(challengeId);
    const verdict = assessProof({
      purpose: challenge.purpose,
      expectedPurpose: purpose,
      expiresAt: challenge.expiresAt,
      consumedAt: challenge.consumedAt,
      invalidatedAt: challenge.invalidatedAt,
      attemptCount: challenge.attemptCount,
      maxAttempts: this.deps.limits.emailCodeAttempts,
      now: this.deps.clock.now(),
      proofMatches: this.deps.codes.same(challenge.verifierHash, this.deps.codes.protect(challenge.userId, proof)),
    });
    if (verdict === "accepted") {
      challenge.consumedAt = this.deps.clock.now().toISOString();
    } else {
      challenge.attemptCount = nextAttemptCount(verdict, challenge.attemptCount);
      if (verdict === "locked") {
        challenge.invalidatedAt = this.deps.clock.now().toISOString();
      }
    }
    if (!(await this.deps.store.saveChallengeState(challenge))) {
      throw new AccessError("CHALLENGE_INVALID", "El código ya no es válido");
    }
    if (verdict !== "accepted") {
      throw new AccessError("CHALLENGE_INVALID", "El código no es válido");
    }
    return challenge;
  }

  private async consumeBinding(challenge: ChallengeRecord): Promise<boolean> {
    challenge.consumedAt = this.deps.clock.now().toISOString();
    return this.deps.store.saveChallengeState(challenge);
  }

  private async replacePassword(user: UserRecord, password: string, activateInvitation: boolean): Promise<void> {
    const now = this.deps.clock.now().toISOString();
    await this.deps.store.revokePasswords(user.id, now);
    await this.deps.store.savePassword({
      id: this.deps.random.uuid(),
      userId: user.id,
      passwordHash: await this.deps.passwords.hash(password),
      changedAt: now,
      revokedAt: null,
    });
    if (activateInvitation) {
      user.status = "active";
      user.emailVerifiedAt = now;
    }
    user.authorizationVersion += 1;
    user.updatedAt = now;
    await this.deps.store.saveUser(user);
    await this.revokeSecurity(user.id, "password_changed");
  }

  private async revokeSecurity(userId: string, reason: string): Promise<void> {
    const user = await this.deps.store.findUserById(userId);
    if (user && reason !== "password_changed") {
      user.authorizationVersion += 1;
      user.updatedAt = this.deps.clock.now().toISOString();
      await this.deps.store.saveUser(user);
    }
    const sessions = await this.deps.store.revokeUserSessions(userId, this.deps.clock.now().toISOString(), reason);
    for (const session of sessions) {
      await this.enqueue(sessionRevoked(session.id, session.userId, reason));
    }
  }

  private async assertRecentOrRestricted(userId: string, restricted: boolean): Promise<void> {
    if (restricted) {
      return;
    }
    const sessions = await this.deps.store.listSessions(userId, { page: 1, pageSize: 20, sort: "-createdAt", includeDeleted: false });
    const current = sessions.items.find((session) => session.revokedAt === null && session.userId === userId);
    if (!current || !isRecentlyVerified(current.verifiedAt, this.deps.clock.now(), this.deps.limits.recentVerificationTtl)) {
      throw new AccessError("RECENT_VERIFICATION_REQUIRED", "Vuelve a iniciar sesión para continuar");
    }
  }

  private async ownedPasskey(userId: string, passkeyId: string) {
    const passkey = await this.deps.store.findPasskey(passkeyId);
    if (!passkey || passkey.userId !== userId || passkey.revokedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "La passkey no está disponible");
    }
    return passkey;
  }

  private async findReset(token: string): Promise<ChallengeRecord | null> {
    const reset = await this.deps.store.findChallengeByVerifier(this.deps.codes.protect("password_reset", token));
    if (reset) {
      return reset;
    }
    return this.deps.store.findChallengeByVerifier(this.deps.codes.protect("invitation", token));
  }

  private async requireChallenge(id: string): Promise<ChallengeRecord> {
    const challenge = await this.deps.store.findChallenge(id);
    if (!challenge) {
      throw new AccessError("CHALLENGE_INVALID", "El desafío no es válido");
    }
    return challenge;
  }

  private async requireUser(id: string): Promise<UserRecord> {
    const user = await this.deps.store.findUserById(id);
    if (!user || user.deletedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "La cuenta no está disponible");
    }
    return user;
  }

  private async limit(key: string, max: number): Promise<void> {
    const result = await this.deps.rates.hit(key, max, this.deps.limits.loginWindowSeconds);
    if (result === "unavailable") {
      throw new AccessError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar el límite de intentos");
    }
    if (result === "limited") {
      throw new AccessError("RATE_LIMITED", "Demasiados intentos. Espera unos minutos");
    }
  }

  private async enqueue(draft: ReturnType<typeof sessionRevoked>): Promise<void> {
    await this.deps.store.saveOutbox({
      id: this.deps.random.uuid(),
      eventType: draft.eventType,
      aggregateId: draft.aggregateId,
      payload: draft.payload,
      occurredAt: this.deps.clock.now().toISOString(),
      publishedAt: null,
    });
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEmail(value: string): string {
  try {
    return normalizeEmail(value);
  } catch {
    throw new AccessError("SESSION_INVALID", GENERIC_LOGIN);
  }
}

export function restoredWithoutAccess(): "disabled" {
  return restoredUserStatus();
}
