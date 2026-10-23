import type { PageQuery } from "../domain/pagination";
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
} from "../domain/records";

export interface Page<T> {
  items: T[];
  totalItems: number;
}

export interface AccessStore {
  transaction<T>(work: (store: AccessStore) => Promise<T>): Promise<T>;
  lockEffectiveAdmins(): Promise<void>;
  findUserByEmail(emailNormalized: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  saveUser(user: UserRecord): Promise<void>;
  listUsers(query: PageQuery): Promise<Page<UserRecord>>;
  activePassword(userId: string): Promise<PasswordRecord | null>;
  savePassword(password: PasswordRecord): Promise<void>;
  revokePasswords(userId: string, at: string): Promise<void>;
  retireUserAccess(userId: string, at: string, actorId: string): Promise<void>;
  saveSession(session: SessionRecord): Promise<void>;
  findSession(id: string): Promise<SessionRecord | null>;
  listSessions(userId: string, query: PageQuery): Promise<Page<SessionRecord>>;
  revokeSession(id: string, at: string, reason: string): Promise<SessionRecord | null>;
  revokeUserSessions(userId: string, at: string, reason: string): Promise<SessionRecord[]>;
  saveRefresh(token: RefreshRecord): Promise<void>;
  consumeRefresh(tokenHash: string, at: string): Promise<{ status: "rotated" | "used"; token: RefreshRecord } | { status: "missing" }>;
  noteRefreshReplacement(id: string, replacementId: string): Promise<void>;
  findChallengeByVerifier(verifierHash: string): Promise<ChallengeRecord | null>;
  findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null>;
  revokeRefreshFamily(familyId: string, at: string): Promise<void>;
  saveChallenge(challenge: ChallengeRecord): Promise<void>;
  findChallenge(id: string): Promise<ChallengeRecord | null>;
  invalidateChallenges(userId: string, purpose: ChallengeRecord["purpose"], at: string): Promise<void>;
  saveChallengeState(challenge: ChallengeRecord): Promise<boolean>;
  passkeyPolicy(userId: string): Promise<PasskeyPolicyRecord>;
  savePasskeyPolicy(policy: PasskeyPolicyRecord): Promise<void>;
  activePasskeys(userId: string): Promise<PasskeyRecord[]>;
  listPasskeys(userId: string, query: PageQuery): Promise<Page<PasskeyRecord>>;
  findPasskey(id: string): Promise<PasskeyRecord | null>;
  savePasskey(passkey: PasskeyRecord): Promise<void>;
  saveIdentity(identity: IdentityRecord): Promise<void>;
  findIdentityBySubject(provider: IdentityRecord["provider"], issuer: string, subject: string): Promise<IdentityRecord | null>;
  listIdentities(userId: string, query: PageQuery): Promise<Page<IdentityRecord>>;
  findIdentity(id: string): Promise<IdentityRecord | null>;
  activeRecoveryCodes(userId: string): Promise<RecoveryCodeRecord[]>;
  saveRecoveryCode(code: RecoveryCodeRecord): Promise<void>;
  revokeRecoveryCodes(userId: string, at: string): Promise<void>;
  consumeRecoveryCode(userId: string, codeHash: string, at: string): Promise<boolean>;
  saveRecoveryRequest(request: RecoveryRequestRecord): Promise<void>;
  findRecoveryRequest(id: string): Promise<RecoveryRequestRecord | null>;
  listApplications(query: PageQuery): Promise<Page<ApplicationRecord>>;
  findApplication(id: string): Promise<ApplicationRecord | null>;
  findApplicationByCode(code: string): Promise<ApplicationRecord | null>;
  saveApplication(application: ApplicationRecord): Promise<void>;
  listRoles(applicationId: string, query: PageQuery): Promise<Page<RoleRecord>>;
  findRole(id: string): Promise<RoleRecord | null>;
  saveRole(role: RoleRecord): Promise<void>;
  activeAssignmentCount(roleId: string, now: string): Promise<number>;
  listAssignments(userId: string, query: PageQuery): Promise<Page<AssignmentRecord>>;
  findAssignment(id: string): Promise<AssignmentRecord | null>;
  saveAssignment(assignment: AssignmentRecord): Promise<void>;
  activeAssignments(userId: string, now: string): Promise<AssignmentRecord[]>;
  effectiveAdminUserIds(now: string): Promise<string[]>;
  permissionsFor(userId: string, now: string): Promise<string[]>;
  bumpUsersForRole(roleId: string): Promise<string[]>;
  saveOidc(transaction: OidcTransactionRecord): Promise<void>;
  consumeOidc(stateHash: string, at: string): Promise<OidcTransactionRecord | "used" | "missing">;
  saveOutbox(event: OutboxRecord): Promise<void>;
  unpublishedOutbox(limit: number): Promise<OutboxRecord[]>;
  markOutboxPublished(id: string, at: string): Promise<void>;
}
