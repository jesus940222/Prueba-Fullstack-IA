import type { AccessStore, Page } from "../access-store";
import type { PageQuery } from "../../domain/pagination";
import { pageWindow } from "../../domain/pagination";
import { roleGrantsEffectiveAdmin } from "../../domain/delegation";
import type {
  ApplicationRecord,
  AssignmentRecord,
  ChallengeRecord,
  IdentityRecord,
  OidcTransactionRecord,
  OutboxRecord,
  PasskeyPolicyRecord,
  PasskeyRecord,
  PasswordRecord,
  RecoveryCodeRecord,
  RecoveryRequestRecord,
  RefreshRecord,
  RoleRecord,
  SessionRecord,
  UserRecord,
} from "../../domain/records";

function timestampOf(value: object): string {
  if ("createdAt" in value && typeof value.createdAt === "string") {
    return value.createdAt;
  }
  if ("linkedAt" in value && typeof value.linkedAt === "string") {
    return value.linkedAt;
  }
  return "";
}

function pageOf<T extends object>(items: T[], query: PageQuery): Page<T> {
  const ordered = [...items].sort((left, right) => {
    const compared = timestampOf(left).localeCompare(timestampOf(right));
    return query.sort === "createdAt" ? compared : -compared;
  });
  const { offset, limit } = pageWindow(query.page, query.pageSize);
  return { items: ordered.slice(offset, offset + limit), totalItems: ordered.length };
}

export class MemoryAccessStore implements AccessStore {
  readonly users = new Map<string, UserRecord>();
  readonly passwords: PasswordRecord[] = [];
  readonly sessions = new Map<string, SessionRecord>();
  readonly refreshes: RefreshRecord[] = [];
  readonly challenges = new Map<string, ChallengeRecord>();
  readonly policies = new Map<string, PasskeyPolicyRecord>();
  readonly passkeys: PasskeyRecord[] = [];
  readonly identities: IdentityRecord[] = [];
  readonly recoveryCodes: RecoveryCodeRecord[] = [];
  readonly recoveryRequests = new Map<string, RecoveryRequestRecord>();
  readonly applications = new Map<string, ApplicationRecord>();
  readonly roles = new Map<string, RoleRecord>();
  readonly assignments: AssignmentRecord[] = [];
  readonly oidc: OidcTransactionRecord[] = [];
  readonly outbox: OutboxRecord[] = [];
  lockCalls = 0;

  async transaction<T>(work: (store: AccessStore) => Promise<T>): Promise<T> {
    return work(this);
  }

  async lockEffectiveAdmins(): Promise<void> {
    this.lockCalls += 1;
  }

  async findUserByEmail(emailNormalized: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((user) => user.emailNormalized === emailNormalized) ?? null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async saveUser(user: UserRecord): Promise<void> {
    this.users.set(user.id, { ...user });
  }

  async listUsers(query: PageQuery): Promise<Page<UserRecord>> {
    const items = [...this.users.values()].filter((user) => {
      if (!query.includeDeleted && user.deletedAt !== null) {
        return false;
      }
      return query.status === undefined || user.status === query.status;
    });
    return pageOf(items, query);
  }

  async activePassword(userId: string): Promise<PasswordRecord | null> {
    return this.passwords.find((item) => item.userId === userId && item.revokedAt === null) ?? null;
  }

  async savePassword(password: PasswordRecord): Promise<void> {
    this.passwords.push({ ...password });
  }

  async retireUserAccess(userId: string, at: string, actorId: string): Promise<void> {
    await this.revokePasswords(userId, at);
    for (const passkey of this.passkeys) {
      if (passkey.userId === userId && passkey.revokedAt === null) {
        passkey.revokedAt = at;
        passkey.revokedBy = actorId;
      }
    }
    for (const identity of this.identities) {
      if (identity.userId === userId && identity.revokedAt === null) {
        identity.revokedAt = at;
      }
    }
    for (const assignment of this.assignments) {
      if (assignment.userId === userId && assignment.deletedAt === null) {
        assignment.deletedAt = at;
        assignment.deletedBy = actorId;
      }
    }
  }

  async revokePasswords(userId: string, at: string): Promise<void> {
    for (const password of this.passwords) {
      if (password.userId === userId && password.revokedAt === null) {
        password.revokedAt = at;
      }
    }
  }

  async saveSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async listSessions(userId: string, query: PageQuery): Promise<Page<SessionRecord>> {
    return pageOf([...this.sessions.values()].filter((session) => session.userId === userId), query);
  }

  async revokeSession(id: string, at: string, reason: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }
    if (session.revokedAt === null) {
      session.revokedAt = at;
      session.revocationReason = reason;
    }
    return { ...session };
  }

  async revokeUserSessions(userId: string, at: string, reason: string): Promise<SessionRecord[]> {
    const revoked: SessionRecord[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        session.revokedAt = at;
        session.revocationReason = reason;
        revoked.push({ ...session });
      }
    }
    return revoked;
  }

  async saveRefresh(token: RefreshRecord): Promise<void> {
    this.refreshes.push({ ...token });
  }

  async consumeRefresh(tokenHash: string, at: string): Promise<{ status: "rotated" | "used"; token: RefreshRecord } | { status: "missing" }> {
    const token = this.refreshes.find((item) => item.tokenHash === tokenHash);
    if (!token) {
      return { status: "missing" };
    }
    if (token.usedAt !== null || token.revokedAt !== null) {
      return { status: "used", token: { ...token } };
    }
    const snapshot = { ...token };
    token.usedAt = at;
    return { status: "rotated", token: snapshot };
  }

  async noteRefreshReplacement(id: string, replacementId: string): Promise<void> {
    const token = this.refreshes.find((item) => item.id === id);
    if (token) {
      token.replacedById = replacementId;
    }
  }

  async findChallengeByVerifier(verifierHash: string): Promise<ChallengeRecord | null> {
    const found = [...this.challenges.values()].find((item) => item.verifierHash === verifierHash);
    return found ? { ...found } : null;
  }

  async findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null> {
    return this.refreshes.find((item) => item.tokenHash === tokenHash) ?? null;
  }

  async revokeRefreshFamily(familyId: string, at: string): Promise<void> {
    for (const token of this.refreshes) {
      if (token.familyId === familyId && token.revokedAt === null) {
        token.revokedAt = at;
      }
    }
  }

  async saveChallenge(challenge: ChallengeRecord): Promise<void> {
    this.challenges.set(challenge.id, { ...challenge });
  }

  async findChallenge(id: string): Promise<ChallengeRecord | null> {
    const challenge = this.challenges.get(id);
    return challenge ? { ...challenge } : null;
  }

  async invalidateChallenges(userId: string, purpose: ChallengeRecord["purpose"], at: string): Promise<void> {
    for (const challenge of this.challenges.values()) {
      if (challenge.userId === userId && challenge.purpose === purpose && challenge.consumedAt === null && challenge.invalidatedAt === null) {
        challenge.invalidatedAt = at;
      }
    }
  }

  async saveChallengeState(challenge: ChallengeRecord): Promise<boolean> {
    const current = this.challenges.get(challenge.id);
    if (!current || current.consumedAt !== null) {
      return false;
    }
    this.challenges.set(challenge.id, { ...challenge });
    return true;
  }

  async passkeyPolicy(userId: string): Promise<PasskeyPolicyRecord> {
    return this.policies.get(userId) ?? { userId, status: "disabled", enabledAt: null, activatedAt: null };
  }

  async savePasskeyPolicy(policy: PasskeyPolicyRecord): Promise<void> {
    this.policies.set(policy.userId, { ...policy });
  }

  async activePasskeys(userId: string): Promise<PasskeyRecord[]> {
    return this.passkeys.filter((item) => item.userId === userId && item.revokedAt === null).map((item) => ({ ...item }));
  }

  async listPasskeys(userId: string, query: PageQuery): Promise<Page<PasskeyRecord>> {
    return pageOf(this.passkeys.filter((item) => item.userId === userId && item.revokedAt === null), query);
  }

  async findPasskey(id: string): Promise<PasskeyRecord | null> {
    return this.passkeys.find((item) => item.id === id) ?? null;
  }

  async savePasskey(passkey: PasskeyRecord): Promise<void> {
    const index = this.passkeys.findIndex((item) => item.id === passkey.id);
    if (index === -1) {
      this.passkeys.push({ ...passkey });
    } else {
      this.passkeys[index] = { ...passkey };
    }
  }

  async saveIdentity(identity: IdentityRecord): Promise<void> {
    const index = this.identities.findIndex((item) => item.id === identity.id);
    if (index === -1) {
      this.identities.push({ ...identity });
    } else {
      this.identities[index] = { ...identity };
    }
  }

  async findIdentityBySubject(provider: IdentityRecord["provider"], issuer: string, subject: string): Promise<IdentityRecord | null> {
    return this.identities.find((item) => item.provider === provider && item.issuer === issuer && item.subject === subject) ?? null;
  }

  async listIdentities(userId: string, query: PageQuery): Promise<Page<IdentityRecord>> {
    return pageOf(this.identities.filter((item) => item.userId === userId && item.revokedAt === null), query);
  }

  async findIdentity(id: string): Promise<IdentityRecord | null> {
    return this.identities.find((item) => item.id === id) ?? null;
  }

  async activeRecoveryCodes(userId: string): Promise<RecoveryCodeRecord[]> {
    return this.recoveryCodes.filter((item) => item.userId === userId && item.usedAt === null && item.revokedAt === null);
  }

  async saveRecoveryCode(code: RecoveryCodeRecord): Promise<void> {
    this.recoveryCodes.push({ ...code });
  }

  async revokeRecoveryCodes(userId: string, at: string): Promise<void> {
    for (const code of this.recoveryCodes) {
      if (code.userId === userId && code.revokedAt === null && code.usedAt === null) {
        code.revokedAt = at;
      }
    }
  }

  async consumeRecoveryCode(userId: string, codeHash: string, at: string): Promise<boolean> {
    const code = this.recoveryCodes.find((item) => item.userId === userId && item.codeHash === codeHash && item.usedAt === null && item.revokedAt === null);
    if (!code) {
      return false;
    }
    code.usedAt = at;
    return true;
  }

  async saveRecoveryRequest(request: RecoveryRequestRecord): Promise<void> {
    this.recoveryRequests.set(request.id, { ...request });
  }

  async findRecoveryRequest(id: string): Promise<RecoveryRequestRecord | null> {
    return this.recoveryRequests.get(id) ?? null;
  }

  async listApplications(query: PageQuery): Promise<Page<ApplicationRecord>> {
    return pageOf([...this.applications.values()].filter((item) => query.includeDeleted || item.deletedAt === null), query);
  }

  async findApplication(id: string): Promise<ApplicationRecord | null> {
    return this.applications.get(id) ?? null;
  }

  async findApplicationByCode(code: string): Promise<ApplicationRecord | null> {
    return [...this.applications.values()].find((item) => item.code === code && item.deletedAt === null) ?? null;
  }

  async saveApplication(application: ApplicationRecord): Promise<void> {
    this.applications.set(application.id, { ...application });
  }

  async listRoles(applicationId: string, query: PageQuery): Promise<Page<RoleRecord>> {
    return pageOf(
      [...this.roles.values()].filter((role) => role.applicationId === applicationId && (query.includeDeleted || role.deletedAt === null)),
      query,
    );
  }

  async findRole(id: string): Promise<RoleRecord | null> {
    return this.roles.get(id) ?? null;
  }

  async saveRole(role: RoleRecord): Promise<void> {
    this.roles.set(role.id, { ...role, permissions: [...role.permissions] });
  }

  async activeAssignmentCount(roleId: string, now: string): Promise<number> {
    return this.assignments.filter((item) => item.roleId === roleId && item.deletedAt === null && (item.expiresAt === null || item.expiresAt > now)).length;
  }

  async listAssignments(userId: string, query: PageQuery): Promise<Page<AssignmentRecord>> {
    return pageOf(this.assignments.filter((item) => item.userId === userId && item.deletedAt === null), query);
  }

  async findAssignment(id: string): Promise<AssignmentRecord | null> {
    return this.assignments.find((item) => item.id === id) ?? null;
  }

  async saveAssignment(assignment: AssignmentRecord): Promise<void> {
    const index = this.assignments.findIndex((item) => item.id === assignment.id);
    if (index === -1) {
      this.assignments.push({ ...assignment });
    } else {
      this.assignments[index] = { ...assignment };
    }
  }

  async activeAssignments(userId: string, now: string): Promise<AssignmentRecord[]> {
    return this.assignments.filter((item) => item.userId === userId && item.deletedAt === null && (item.expiresAt === null || item.expiresAt > now));
  }

  async effectiveAdminUserIds(now: string): Promise<string[]> {
    const ids = new Set<string>();
    for (const assignment of this.assignments) {
      if (assignment.deletedAt !== null || (assignment.expiresAt !== null && assignment.expiresAt <= now)) {
        continue;
      }
      const role = this.roles.get(assignment.roleId);
      const user = this.users.get(assignment.userId);
      if (!role || role.deletedAt !== null || !roleGrantsEffectiveAdmin(role.permissions) || !user || user.deletedAt !== null || user.status !== "active") {
        continue;
      }
      ids.add(user.id);
    }
    return [...ids];
  }

  async permissionsFor(userId: string, now: string): Promise<string[]> {
    const codes = new Set<string>();
    for (const assignment of await this.activeAssignments(userId, now)) {
      const role = this.roles.get(assignment.roleId);
      if (role && role.deletedAt === null) {
        for (const code of role.permissions) {
          codes.add(code);
        }
      }
    }
    return [...codes];
  }

  async bumpUsersForRole(roleId: string): Promise<string[]> {
    const userIds = this.assignments.filter((item) => item.roleId === roleId && item.deletedAt === null).map((item) => item.userId);
    for (const userId of new Set(userIds)) {
      const user = this.users.get(userId);
      if (user) {
        user.authorizationVersion += 1;
      }
    }
    return [...new Set(userIds)];
  }

  async saveOidc(transaction: OidcTransactionRecord): Promise<void> {
    this.oidc.push({ ...transaction });
  }

  async consumeOidc(stateHash: string, at: string): Promise<OidcTransactionRecord | "used" | "missing"> {
    const transaction = this.oidc.find((item) => item.stateHash === stateHash);
    if (!transaction) {
      return "missing";
    }
    if (transaction.consumedAt !== null) {
      return "used";
    }
    transaction.consumedAt = at;
    return { ...transaction };
  }

  async saveOutbox(event: OutboxRecord): Promise<void> {
    this.outbox.push({ ...event, payload: { ...event.payload } });
  }

  async unpublishedOutbox(limit: number): Promise<OutboxRecord[]> {
    return this.outbox.filter((item) => item.publishedAt === null).slice(0, limit);
  }

  async markOutboxPublished(id: string, at: string): Promise<void> {
    const event = this.outbox.find((item) => item.id === id);
    if (event) {
      event.publishedAt = at;
    }
  }
}
