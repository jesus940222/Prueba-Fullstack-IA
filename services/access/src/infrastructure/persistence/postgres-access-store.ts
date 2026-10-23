import { DataSource, type EntityManager } from "typeorm";
import type { AccessStore, Page } from "../../application/access-store";
import { AccessError } from "../../domain/access-error";
import { pageWindow } from "../../domain/pagination";
import type { PageQuery } from "../../domain/pagination";
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

type Runner = DataSource | EntityManager;
type Row = Record<string, unknown>;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

function requiredIso(value: unknown): string {
  return iso(value) ?? new Date(0).toISOString();
}

function userFrom(row: Row): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    emailNormalized: String(row.email_normalized),
    emailVerifiedAt: iso(row.email_verified_at),
    givenName: String(row.given_name),
    familyName: String(row.family_name),
    status: row.status as UserRecord["status"],
    authorizationVersion: Number(row.authorization_version),
    themePreference: row.theme_preference as UserRecord["themePreference"],
    phoneCountryCode: row.phone_country_code === null ? null : String(row.phone_country_code),
    phoneCallingCode: row.phone_calling_code === null ? null : String(row.phone_calling_code),
    phoneNumber: row.phone_number === null ? null : String(row.phone_number),
    phoneE164: row.phone_e164 === null ? null : String(row.phone_e164),
    lastLoginAt: iso(row.last_login_at),
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
    deletedAt: iso(row.deleted_at),
    deletedBy: row.deleted_by === null || row.deleted_by === undefined ? null : String(row.deleted_by),
  };
}

export class PostgresAccessStore implements AccessStore {
  constructor(private readonly runner: Runner) {}

  private async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    const result: unknown = await this.runner.query(sql, params);
    // TypeORM returns [rows, affected] for UPDATE and DELETE. SELECT returns the rows directly.
    if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") {
      return result[0] as Row[];
    }
    return (Array.isArray(result) ? result : []) as Row[];
  }

  async transaction<T>(work: (store: AccessStore) => Promise<T>): Promise<T> {
    if (this.runner instanceof DataSource) {
      return this.runner.transaction((manager) => work(new PostgresAccessStore(manager)));
    }
    return work(this);
  }

  async lockEffectiveAdmins(): Promise<void> {
    await this.query("SELECT pg_advisory_xact_lock(hashtext('portal-access-last-admin'))");
  }

  async findUserByEmail(emailNormalized: string): Promise<UserRecord | null> {
    const rows = await this.query("SELECT * FROM users WHERE email_normalized = $1", [emailNormalized]);
    return rows[0] ? userFrom(rows[0]) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const rows = await this.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? userFrom(rows[0]) : null;
  }

  async saveUser(user: UserRecord): Promise<void> {
    await this.query(
      `INSERT INTO users (
        id, email, email_normalized, email_verified_at, given_name, family_name, status, authorization_version,
        theme_preference, phone_country_code, phone_calling_code, phone_number, phone_e164, last_login_at,
        created_at, updated_at, deleted_at, deleted_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO UPDATE SET
        email_verified_at = EXCLUDED.email_verified_at,
        given_name = EXCLUDED.given_name,
        family_name = EXCLUDED.family_name,
        status = EXCLUDED.status,
        authorization_version = EXCLUDED.authorization_version,
        theme_preference = EXCLUDED.theme_preference,
        phone_country_code = EXCLUDED.phone_country_code,
        phone_calling_code = EXCLUDED.phone_calling_code,
        phone_number = EXCLUDED.phone_number,
        phone_e164 = EXCLUDED.phone_e164,
        last_login_at = EXCLUDED.last_login_at,
        updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at,
        deleted_by = EXCLUDED.deleted_by`,
      [
        user.id, user.email, user.emailNormalized, user.emailVerifiedAt, user.givenName, user.familyName, user.status,
        user.authorizationVersion, user.themePreference, user.phoneCountryCode, user.phoneCallingCode, user.phoneNumber,
        user.phoneE164, user.lastLoginAt, user.createdAt, user.updatedAt, user.deletedAt, user.deletedBy,
      ],
    );
  }

  async listUsers(query: PageQuery): Promise<Page<UserRecord>> {
    const filters = ["($1::boolean OR deleted_at IS NULL)", "($2::text IS NULL OR status = $2)"];
    const params: unknown[] = [query.includeDeleted, query.status ?? null];
    const where = filters.join(" AND ");
    const direction = query.sort === "createdAt" ? "ASC" : "DESC";
    const { offset, limit } = pageWindow(query.page, query.pageSize);
    const rows = await this.query(
      `SELECT * FROM users WHERE ${where} ORDER BY created_at ${direction}, id ASC OFFSET $3 LIMIT $4`,
      [...params, offset, limit],
    );
    const total = await this.query(`SELECT count(*)::int AS total FROM users WHERE ${where}`, params);
    return { items: rows.map(userFrom), totalItems: Number(total[0]?.total ?? 0) };
  }

  async activePassword(userId: string): Promise<PasswordRecord | null> {
    const rows = await this.query("SELECT * FROM password_credentials WHERE user_id = $1 AND revoked_at IS NULL ORDER BY changed_at DESC LIMIT 1", [userId]);
    const row = rows[0];
    return row
      ? { id: String(row.id), userId: String(row.user_id), passwordHash: String(row.password_hash), changedAt: requiredIso(row.changed_at), revokedAt: iso(row.revoked_at) }
      : null;
  }

  async savePassword(password: PasswordRecord): Promise<void> {
    await this.query(
      `INSERT INTO password_credentials (id, user_id, password_hash, changed_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at`,
      [password.id, password.userId, password.passwordHash, password.changedAt, password.revokedAt],
    );
  }

  async revokePasswords(userId: string, at: string): Promise<void> {
    await this.query("UPDATE password_credentials SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL", [userId, at]);
  }

  async retireUserAccess(userId: string, at: string, actorId: string): Promise<void> {
    await this.revokePasswords(userId, at);
    await this.query("UPDATE passkey_credentials SET revoked_at = $2, revoked_by = $3 WHERE user_id = $1 AND revoked_at IS NULL", [userId, at, actorId]);
    await this.query("UPDATE external_identities SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL", [userId, at]);
    await this.query("UPDATE user_roles SET deleted_at = $2, deleted_by = $3 WHERE user_id = $1 AND deleted_at IS NULL", [userId, at, actorId]);
  }

  async saveSession(session: SessionRecord): Promise<void> {
    await this.query(
      `INSERT INTO sessions (
        id, user_id, application_code, authentication_method, verified_at, authorization_version, restricted, csrf_hash,
        created_at, expires_at, last_seen_at, revoked_at, revocation_reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at,
        revoked_at = EXCLUDED.revoked_at,
        revocation_reason = EXCLUDED.revocation_reason,
        csrf_hash = EXCLUDED.csrf_hash,
        authorization_version = EXCLUDED.authorization_version`,
      [
        session.id, session.userId, session.applicationCode, session.authenticationMethod, session.verifiedAt,
        session.authorizationVersion, session.restricted, session.csrfHash, session.createdAt, session.expiresAt,
        session.lastSeenAt, session.revokedAt, session.revocationReason,
      ],
    );
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    const rows = await this.query("SELECT * FROM sessions WHERE id = $1", [id]);
    return rows[0] ? sessionFrom(rows[0]) : null;
  }

  async listSessions(userId: string, query: PageQuery): Promise<Page<SessionRecord>> {
    const { offset, limit } = pageWindow(query.page, query.pageSize);
    const direction = query.sort === "createdAt" ? "ASC" : "DESC";
    const rows = await this.query(`SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at ${direction}, id ASC OFFSET $2 LIMIT $3`, [userId, offset, limit]);
    const total = await this.query("SELECT count(*)::int AS total FROM sessions WHERE user_id = $1", [userId]);
    return { items: rows.map(sessionFrom), totalItems: Number(total[0]?.total ?? 0) };
  }

  async revokeSession(id: string, at: string, reason: string): Promise<SessionRecord | null> {
    const rows = await this.query(
      `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2), revocation_reason = COALESCE(revocation_reason, $3)
       WHERE id = $1 RETURNING *`,
      [id, at, reason],
    );
    return rows[0] ? sessionFrom(rows[0]) : null;
  }

  async revokeUserSessions(userId: string, at: string, reason: string): Promise<SessionRecord[]> {
    const rows = await this.query(
      `UPDATE sessions SET revoked_at = $2, revocation_reason = $3
       WHERE user_id = $1 AND revoked_at IS NULL RETURNING *`,
      [userId, at, reason],
    );
    return rows.map(sessionFrom);
  }

  async saveRefresh(token: RefreshRecord): Promise<void> {
    await this.query(
      `INSERT INTO refresh_tokens (id, session_id, family_id, token_hash, expires_at, used_at, revoked_at, replaced_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET used_at = EXCLUDED.used_at, revoked_at = EXCLUDED.revoked_at, replaced_by_id = EXCLUDED.replaced_by_id`,
      [token.id, token.sessionId, token.familyId, token.tokenHash, token.expiresAt, token.usedAt, token.revokedAt, token.replacedById],
    );
  }

  async consumeRefresh(tokenHash: string, at: string): Promise<{ status: "rotated" | "used"; token: RefreshRecord } | { status: "missing" }> {
    const updated = await this.query(
      `UPDATE refresh_tokens SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING *`,
      [tokenHash, at],
    );
    if (updated[0]) {
      const token = refreshFrom(updated[0]);
      token.usedAt = null;
      return { status: "rotated", token };
    }
    const existing = await this.findRefreshByHash(tokenHash);
    return existing ? { status: "used", token: existing } : { status: "missing" };
  }

  async noteRefreshReplacement(id: string, replacementId: string): Promise<void> {
    await this.query("UPDATE refresh_tokens SET replaced_by_id = $2 WHERE id = $1", [id, replacementId]);
  }

  async findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null> {
    const rows = await this.query("SELECT * FROM refresh_tokens WHERE token_hash = $1", [tokenHash]);
    return rows[0] ? refreshFrom(rows[0]) : null;
  }

  async revokeRefreshFamily(familyId: string, at: string): Promise<void> {
    await this.query("UPDATE refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL", [familyId, at]);
  }

  async saveChallenge(challenge: ChallengeRecord): Promise<void> {
    await this.query(
      `INSERT INTO auth_challenges (id, user_id, purpose, verifier_hash, attempt_count, expires_at, consumed_at, invalidated_at, binding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [challenge.id, challenge.userId, challenge.purpose, challenge.verifierHash, challenge.attemptCount, challenge.expiresAt, challenge.consumedAt, challenge.invalidatedAt, challenge.binding],
    );
  }

  async findChallenge(id: string): Promise<ChallengeRecord | null> {
    const rows = await this.query("SELECT * FROM auth_challenges WHERE id = $1", [id]);
    return rows[0] ? challengeFrom(rows[0]) : null;
  }

  async findChallengeByVerifier(verifierHash: string): Promise<ChallengeRecord | null> {
    const rows = await this.query("SELECT * FROM auth_challenges WHERE verifier_hash = $1 ORDER BY expires_at DESC LIMIT 1", [verifierHash]);
    return rows[0] ? challengeFrom(rows[0]) : null;
  }

  async invalidateChallenges(userId: string, purpose: ChallengeRecord["purpose"], at: string): Promise<void> {
    await this.query(
      "UPDATE auth_challenges SET invalidated_at = $3 WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND invalidated_at IS NULL",
      [userId, purpose, at],
    );
  }

  async saveChallengeState(challenge: ChallengeRecord): Promise<boolean> {
    const rows = await this.query(
      `UPDATE auth_challenges SET attempt_count = $2, consumed_at = $3, invalidated_at = $4
       WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
      [challenge.id, challenge.attemptCount, challenge.consumedAt, challenge.invalidatedAt],
    );
    return rows.length > 0;
  }

  async passkeyPolicy(userId: string): Promise<PasskeyPolicyRecord> {
    const rows = await this.query("SELECT * FROM passkey_policies WHERE user_id = $1", [userId]);
    const row = rows[0];
    return row
      ? { userId, status: row.status as PasskeyPolicyRecord["status"], enabledAt: iso(row.enabled_at), activatedAt: iso(row.activated_at) }
      : { userId, status: "disabled", enabledAt: null, activatedAt: null };
  }

  async savePasskeyPolicy(policy: PasskeyPolicyRecord): Promise<void> {
    await this.query(
      `INSERT INTO passkey_policies (user_id, status, enabled_at, activated_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, enabled_at = EXCLUDED.enabled_at, activated_at = EXCLUDED.activated_at`,
      [policy.userId, policy.status, policy.enabledAt, policy.activatedAt],
    );
  }

  async activePasskeys(userId: string): Promise<PasskeyRecord[]> {
    const rows = await this.query("SELECT * FROM passkey_credentials WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    return rows.map(passkeyFrom);
  }

  async listPasskeys(userId: string, query: PageQuery): Promise<Page<PasskeyRecord>> {
    const { offset, limit } = pageWindow(query.page, query.pageSize);
    const rows = await this.query("SELECT * FROM passkey_credentials WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC OFFSET $2 LIMIT $3", [userId, offset, limit]);
    const total = await this.query("SELECT count(*)::int AS total FROM passkey_credentials WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    return { items: rows.map(passkeyFrom), totalItems: Number(total[0]?.total ?? 0) };
  }

  async findPasskey(id: string): Promise<PasskeyRecord | null> {
    const rows = await this.query("SELECT * FROM passkey_credentials WHERE id = $1", [id]);
    return rows[0] ? passkeyFrom(rows[0]) : null;
  }

  async savePasskey(passkey: PasskeyRecord): Promise<void> {
    await this.query(
      `INSERT INTO passkey_credentials (
        id, user_id, credential_id, public_key, sign_count, transports, name, device_type, backed_up, created_at, last_used_at, revoked_at, revoked_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sign_count = EXCLUDED.sign_count, last_used_at = EXCLUDED.last_used_at, revoked_at = EXCLUDED.revoked_at, revoked_by = EXCLUDED.revoked_by`,
      [passkey.id, passkey.userId, passkey.credentialId, passkey.publicKey, passkey.signCount, passkey.transports.join(","), passkey.name, passkey.deviceType, passkey.backedUp, passkey.createdAt, passkey.lastUsedAt, passkey.revokedAt, passkey.revokedBy],
    );
  }

  async saveIdentity(identity: IdentityRecord): Promise<void> {
    await this.query(
      `INSERT INTO external_identities (id, user_id, provider, issuer, subject, linked_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at`,
      [identity.id, identity.userId, identity.provider, identity.issuer, identity.subject, identity.linkedAt, identity.revokedAt],
    );
  }

  async findIdentityBySubject(provider: IdentityRecord["provider"], issuer: string, subject: string): Promise<IdentityRecord | null> {
    const rows = await this.query("SELECT * FROM external_identities WHERE provider = $1 AND issuer = $2 AND subject = $3", [provider, issuer, subject]);
    return rows[0] ? identityFrom(rows[0]) : null;
  }

  async listIdentities(userId: string, query: PageQuery): Promise<Page<IdentityRecord>> {
    const { offset, limit } = pageWindow(query.page, query.pageSize);
    const rows = await this.query("SELECT * FROM external_identities WHERE user_id = $1 AND revoked_at IS NULL ORDER BY linked_at DESC OFFSET $2 LIMIT $3", [userId, offset, limit]);
    const total = await this.query("SELECT count(*)::int AS total FROM external_identities WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    return { items: rows.map(identityFrom), totalItems: Number(total[0]?.total ?? 0) };
  }

  async findIdentity(id: string): Promise<IdentityRecord | null> {
    const rows = await this.query("SELECT * FROM external_identities WHERE id = $1", [id]);
    return rows[0] ? identityFrom(rows[0]) : null;
  }

  async activeRecoveryCodes(userId: string): Promise<RecoveryCodeRecord[]> {
    const rows = await this.query("SELECT * FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [userId]);
    return rows.map(recoveryFrom);
  }

  async saveRecoveryCode(code: RecoveryCodeRecord): Promise<void> {
    await this.query("INSERT INTO recovery_codes (id, user_id, code_hash, used_at, revoked_at) VALUES ($1,$2,$3,$4,$5)", [code.id, code.userId, code.codeHash, code.usedAt, code.revokedAt]);
  }

  async revokeRecoveryCodes(userId: string, at: string): Promise<void> {
    await this.query("UPDATE recovery_codes SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL AND used_at IS NULL", [userId, at]);
  }

  async consumeRecoveryCode(userId: string, codeHash: string, at: string): Promise<boolean> {
    const rows = await this.query(
      "UPDATE recovery_codes SET used_at = $3 WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL AND revoked_at IS NULL RETURNING id",
      [userId, codeHash, at],
    );
    return rows.length > 0;
  }

  async saveRecoveryRequest(request: RecoveryRequestRecord): Promise<void> {
    await this.query(
      "INSERT INTO recovery_requests (id, user_id, initiator_user_id, reason, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [request.id, request.userId, request.initiatorUserId, request.reason, request.status, request.createdAt],
    );
  }

  async findRecoveryRequest(id: string): Promise<RecoveryRequestRecord | null> {
    const rows = await this.query("SELECT * FROM recovery_requests WHERE id = $1", [id]);
    const row = rows[0];
    return row
      ? { id: String(row.id), userId: String(row.user_id), initiatorUserId: String(row.initiator_user_id), reason: String(row.reason), status: "pending", createdAt: requiredIso(row.created_at) }
      : null;
  }

  async listApplications(query: PageQuery): Promise<Page<ApplicationRecord>> {
    return this.pageApplications(query);
  }

  async findApplication(id: string): Promise<ApplicationRecord | null> {
    const rows = await this.query("SELECT * FROM applications WHERE id = $1", [id]);
    return rows[0] ? applicationFrom(rows[0]) : null;
  }

  async findApplicationByCode(code: string): Promise<ApplicationRecord | null> {
    const rows = await this.query("SELECT * FROM applications WHERE code = $1 AND deleted_at IS NULL", [code]);
    return rows[0] ? applicationFrom(rows[0]) : null;
  }

  async saveApplication(application: ApplicationRecord): Promise<void> {
    await this.query(
      `INSERT INTO applications (id, code, name, description, status, created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, deleted_at = EXCLUDED.deleted_at`,
      [application.id, application.code, application.name, application.description, application.status, application.createdAt, application.deletedAt],
    );
  }

  async listRoles(applicationId: string, query: PageQuery): Promise<Page<RoleRecord>> {
    const { offset, limit } = pageWindow(query.page, query.pageSize);
    const deleted = query.includeDeleted ? "" : "AND deleted_at IS NULL";
    const rows = await this.query(`SELECT * FROM roles WHERE application_id = $1 ${deleted} ORDER BY created_at DESC OFFSET $2 LIMIT $3`, [applicationId, offset, limit]);
    const total = await this.query(`SELECT count(*)::int AS total FROM roles WHERE application_id = $1 ${deleted}`, [applicationId]);
    const items = [];
    for (const row of rows) {
      items.push(await this.roleFrom(row));
    }
    return { items, totalItems: Number(total[0]?.total ?? 0) };
  }

  async findRole(id: string): Promise<RoleRecord | null> {
    const rows = await this.query("SELECT * FROM roles WHERE id = $1", [id]);
    return rows[0] ? this.roleFrom(rows[0]) : null;
  }

  async saveRole(role: RoleRecord): Promise<void> {
    await this.query(
      `INSERT INTO roles (id, application_id, code, name, description, system, assignable_by_access_admin, version, created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, version = EXCLUDED.version, deleted_at = EXCLUDED.deleted_at`,
      [role.id, role.applicationId, role.code, role.name, role.description, role.system, role.assignableByAccessAdmin, role.version, role.createdAt, role.deletedAt],
    );
    const permissions = await this.query("SELECT id, code FROM permissions WHERE code = ANY($1)", [role.permissions]);
    if (permissions.length !== role.permissions.length) {
      throw new AccessError("BUSINESS_RULE", "Hay un permiso que no existe en el catálogo");
    }
    await this.query("DELETE FROM role_permissions WHERE role_id = $1", [role.id]);
    for (const permission of permissions) {
      await this.query(
        "INSERT INTO role_permissions (id, role_id, permission_id) VALUES (gen_random_uuid(), $1, $2)",
        [role.id, permission.id],
      );
    }
  }

  async activeAssignmentCount(roleId: string, now: string): Promise<number> {
    const rows = await this.query(
      "SELECT count(*)::int AS total FROM user_roles WHERE role_id = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > $2)",
      [roleId, now],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async listAssignments(userId: string, query: PageQuery): Promise<Page<AssignmentRecord>> {
    const { offset, limit } = pageWindow(query.page, query.pageSize);
    const rows = await this.query("SELECT * FROM user_roles WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC OFFSET $2 LIMIT $3", [userId, offset, limit]);
    const total = await this.query("SELECT count(*)::int AS total FROM user_roles WHERE user_id = $1 AND deleted_at IS NULL", [userId]);
    return { items: rows.map(assignmentFrom), totalItems: Number(total[0]?.total ?? 0) };
  }

  async findAssignment(id: string): Promise<AssignmentRecord | null> {
    const rows = await this.query("SELECT * FROM user_roles WHERE id = $1", [id]);
    return rows[0] ? assignmentFrom(rows[0]) : null;
  }

  async saveAssignment(assignment: AssignmentRecord): Promise<void> {
    await this.query(
      `INSERT INTO user_roles (id, user_id, role_id, assigned_by, expires_at, created_at, deleted_at, deleted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at, deleted_by = EXCLUDED.deleted_by, expires_at = EXCLUDED.expires_at`,
      [assignment.id, assignment.userId, assignment.roleId, assignment.assignedBy, assignment.expiresAt, assignment.createdAt, assignment.deletedAt, assignment.deletedBy],
    );
  }

  async activeAssignments(userId: string, now: string): Promise<AssignmentRecord[]> {
    const rows = await this.query(
      "SELECT * FROM user_roles WHERE user_id = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > $2)",
      [userId, now],
    );
    return rows.map(assignmentFrom);
  }

  async effectiveAdminUserIds(now: string): Promise<string[]> {
    const rows = await this.query(
      `SELECT DISTINCT ur.user_id
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL AND u.status = 'active'
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       JOIN role_permissions rp ON rp.role_id = r.id AND rp.deleted_at IS NULL
       JOIN permissions p ON p.id = rp.permission_id AND p.code = 'users:roles:assign'
       WHERE ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > $1)`,
      [now],
    );
    return rows.map((row) => String(row.user_id));
  }

  async permissionsFor(userId: string, now: string): Promise<string[]> {
    const rows = await this.query(
      `SELECT DISTINCT p.code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       JOIN role_permissions rp ON rp.role_id = r.id AND rp.deleted_at IS NULL
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = $1 AND ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > $2)`,
      [userId, now],
    );
    return rows.map((row) => String(row.code));
  }

  async bumpUsersForRole(roleId: string): Promise<string[]> {
    const rows = await this.query(
      `UPDATE users SET authorization_version = authorization_version + 1, updated_at = now()
       WHERE id IN (SELECT user_id FROM user_roles WHERE role_id = $1 AND deleted_at IS NULL)
       RETURNING id`,
      [roleId],
    );
    return rows.map((row) => String(row.id));
  }

  async saveOidc(transaction: OidcTransactionRecord): Promise<void> {
    await this.query(
      `INSERT INTO oidc_transactions (id, state_hash, nonce_hash, verifier, provider, intent, user_id, return_to, expires_at, consumed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [transaction.id, transaction.stateHash, transaction.nonceHash, transaction.verifier, transaction.provider, transaction.intent, transaction.userId, transaction.returnTo, transaction.expiresAt, transaction.consumedAt],
    );
  }

  async consumeOidc(stateHash: string, at: string): Promise<OidcTransactionRecord | "used" | "missing"> {
    const rows = await this.query(
      "UPDATE oidc_transactions SET consumed_at = $2 WHERE state_hash = $1 AND consumed_at IS NULL RETURNING *",
      [stateHash, at],
    );
    if (rows[0]) {
      const record = oidcFrom(rows[0]);
      record.consumedAt = null;
      return record;
    }
    const existing = await this.query("SELECT id FROM oidc_transactions WHERE state_hash = $1", [stateHash]);
    return existing[0] ? "used" : "missing";
  }

  async saveOutbox(event: OutboxRecord): Promise<void> {
    await this.query(
      "INSERT INTO outbox_events (id, event_type, aggregate_id, payload, occurred_at, published_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6)",
      [event.id, event.eventType, event.aggregateId, JSON.stringify(event.payload), event.occurredAt, event.publishedAt],
    );
  }

  async unpublishedOutbox(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.query("SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY occurred_at ASC LIMIT $1", [limit]);
    return rows.map(outboxFrom);
  }

  async markOutboxPublished(id: string, at: string): Promise<void> {
    await this.query("UPDATE outbox_events SET published_at = $2 WHERE id = $1", [id, at]);
  }

  private async pageApplications(query: PageQuery): Promise<Page<ApplicationRecord>> {
    const { offset, limit } = pageWindow(query.page, query.pageSize);
    const deleted = query.includeDeleted ? "" : "WHERE deleted_at IS NULL";
    const rows = await this.query(`SELECT * FROM applications ${deleted} ORDER BY created_at DESC OFFSET $1 LIMIT $2`, [offset, limit]);
    const total = await this.query(`SELECT count(*)::int AS total FROM applications ${deleted}`);
    return { items: rows.map(applicationFrom), totalItems: Number(total[0]?.total ?? 0) };
  }

  private async roleFrom(row: Row): Promise<RoleRecord> {
    const permissions = await this.query(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1 AND rp.deleted_at IS NULL ORDER BY p.code`,
      [row.id],
    );
    return {
      id: String(row.id),
      applicationId: String(row.application_id),
      code: String(row.code),
      name: String(row.name),
      description: String(row.description),
      system: Boolean(row.system),
      assignableByAccessAdmin: Boolean(row.assignable_by_access_admin),
      version: Number(row.version),
      permissions: permissions.map((item) => String(item.code)),
      createdAt: requiredIso(row.created_at),
      deletedAt: iso(row.deleted_at),
    };
  }
}

function sessionFrom(row: Row): SessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    applicationCode: String(row.application_code),
    authenticationMethod: String(row.authentication_method),
    verifiedAt: requiredIso(row.verified_at),
    authorizationVersion: Number(row.authorization_version),
    restricted: Boolean(row.restricted),
    csrfHash: String(row.csrf_hash),
    createdAt: requiredIso(row.created_at),
    expiresAt: requiredIso(row.expires_at),
    lastSeenAt: requiredIso(row.last_seen_at),
    revokedAt: iso(row.revoked_at),
    revocationReason: row.revocation_reason === null || row.revocation_reason === undefined ? null : String(row.revocation_reason),
  };
}

function refreshFrom(row: Row): RefreshRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    familyId: String(row.family_id),
    tokenHash: String(row.token_hash),
    expiresAt: requiredIso(row.expires_at),
    usedAt: iso(row.used_at),
    revokedAt: iso(row.revoked_at),
    replacedById: row.replaced_by_id === null || row.replaced_by_id === undefined ? null : String(row.replaced_by_id),
  };
}

function challengeFrom(row: Row): ChallengeRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    purpose: row.purpose as ChallengeRecord["purpose"],
    verifierHash: String(row.verifier_hash),
    attemptCount: Number(row.attempt_count),
    expiresAt: requiredIso(row.expires_at),
    consumedAt: iso(row.consumed_at),
    invalidatedAt: iso(row.invalidated_at),
    binding: String(row.binding),
  };
}

function passkeyFrom(row: Row): PasskeyRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    credentialId: String(row.credential_id),
    publicKey: String(row.public_key),
    signCount: Number(row.sign_count),
    transports: String(row.transports).length === 0 ? [] : String(row.transports).split(","),
    name: String(row.name),
    deviceType: String(row.device_type),
    backedUp: Boolean(row.backed_up),
    createdAt: requiredIso(row.created_at),
    lastUsedAt: iso(row.last_used_at),
    revokedAt: iso(row.revoked_at),
    revokedBy: row.revoked_by === null || row.revoked_by === undefined ? null : String(row.revoked_by),
  };
}

function identityFrom(row: Row): IdentityRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    provider: row.provider as IdentityRecord["provider"],
    issuer: String(row.issuer),
    subject: String(row.subject),
    linkedAt: requiredIso(row.linked_at),
    revokedAt: iso(row.revoked_at),
  };
}

function recoveryFrom(row: Row): RecoveryCodeRecord {
  return { id: String(row.id), userId: String(row.user_id), codeHash: String(row.code_hash), usedAt: iso(row.used_at), revokedAt: iso(row.revoked_at) };
}

function applicationFrom(row: Row): ApplicationRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    description: String(row.description),
    status: row.status as ApplicationRecord["status"],
    createdAt: requiredIso(row.created_at),
    deletedAt: iso(row.deleted_at),
  };
}

function assignmentFrom(row: Row): AssignmentRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    roleId: String(row.role_id),
    assignedBy: row.assigned_by === null || row.assigned_by === undefined ? "" : String(row.assigned_by),
    expiresAt: iso(row.expires_at),
    createdAt: requiredIso(row.created_at),
    deletedAt: iso(row.deleted_at),
    deletedBy: row.deleted_by === null || row.deleted_by === undefined ? null : String(row.deleted_by),
  };
}

function oidcFrom(row: Row): OidcTransactionRecord {
  return {
    id: String(row.id),
    stateHash: String(row.state_hash),
    nonceHash: String(row.nonce_hash),
    verifier: String(row.verifier),
    provider: row.provider as OidcTransactionRecord["provider"],
    intent: row.intent as OidcTransactionRecord["intent"],
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    returnTo: String(row.return_to),
    expiresAt: requiredIso(row.expires_at),
    consumedAt: iso(row.consumed_at),
  };
}

function outboxFrom(row: Row): OutboxRecord {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as Record<string, string | number> : row.payload as Record<string, string | number>;
  return {
    id: String(row.id),
    eventType: String(row.event_type),
    aggregateId: String(row.aggregate_id),
    payload,
    occurredAt: requiredIso(row.occurred_at),
    publishedAt: iso(row.published_at),
  };
}
