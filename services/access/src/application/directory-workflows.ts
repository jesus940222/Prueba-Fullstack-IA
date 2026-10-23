import { AccessError } from "../domain/access-error";
import { PERMISSIONS, roleDefinition } from "../domain/catalog";
import {
  assertCanAssignRole,
  assertCanReplaceRolePermissions,
  assertCustomRolePermissions,
  assertKeepsEffectiveAdmin,
  assertSystemRoleUntouched,
} from "../domain/delegation";
import { assertDisplayName, assertRoleCode, normalizeEmail, normalizePhone } from "../domain/identity";
import { assignmentChanged, roleUpdated, sessionRevoked, userDeleted } from "../domain/outbox";
import type { PageQuery } from "../domain/pagination";
import { policyAfterDisable, policyAfterEnable } from "../domain/passkey-policy";
import type { ApplicationRecord, RoleRecord, UserRecord } from "../domain/records";
import { restoredUserStatus } from "../domain/recovery-policy";
import type { AccessStore } from "./access-store";
import type { Clock, Mailer, OneTimeCode, RandomSource } from "./ports";
import { renderSecurityEmail } from "./security-email";

export class DirectoryWorkflows {
  constructor(
    private readonly store: AccessStore,
    private readonly random: RandomSource,
    private readonly clock: Clock,
    private readonly codes: OneTimeCode,
    private readonly mailer: Mailer,
    private readonly portalUrl: string,
    private readonly emailCodeTtl: number,
  ) {}

  async invite(actorId: string, input: { email: string; givenName: string; familyName: string }): Promise<UserRecord> {
    const emailNormalized = normalizeEmail(input.email);
    const existing = await this.store.findUserByEmail(emailNormalized);
    if (existing) {
      throw new AccessError("CONFLICT", "Ese correo ya está reservado");
    }
    const now = this.clock.now().toISOString();
    const user: UserRecord = {
      id: this.random.uuid(),
      email: emailNormalized,
      emailNormalized,
      emailVerifiedAt: null,
      givenName: assertDisplayName(input.givenName, "givenName"),
      familyName: assertDisplayName(input.familyName, "familyName"),
      status: "invited",
      authorizationVersion: 1,
      themePreference: "system",
      phoneCountryCode: null,
      phoneCallingCode: null,
      phoneNumber: null,
      phoneE164: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    };
    const token = this.random.token(32);
    await this.store.transaction(async (store) => {
      await store.saveUser(user);
      await store.saveChallenge({
        id: this.random.uuid(),
        userId: user.id,
        purpose: "invitation",
        verifierHash: this.codes.protect("invitation", token),
        attemptCount: 0,
        expiresAt: new Date(this.clock.now().getTime() + this.emailCodeTtl * 1000).toISOString(),
        consumedAt: null,
        invalidatedAt: null,
        binding: actorId,
      });
    });
    await this.mailer.send(renderSecurityEmail({
      to: user.email,
      title: "Invitación al portal",
      code: token,
      expiresMinutes: Math.round(this.emailCodeTtl / 60),
      portalUrl: this.portalUrl,
      purpose: "Crea tu contraseña con este código. No se envía ninguna contraseña legible.",
    }));
    return user;
  }

  async updateUser(actorId: string, userId: string, input: { givenName?: string; familyName?: string; status?: "active" | "disabled" }): Promise<UserRecord> {
    if (input.givenName === undefined && input.familyName === undefined && input.status === undefined) {
      throw new AccessError("VALIDATION_ERROR", "Indica un campo permitido");
    }
    const user = await this.visibleUser(userId);
    if (input.givenName !== undefined) {
      user.givenName = assertDisplayName(input.givenName, "givenName");
    }
    if (input.familyName !== undefined) {
      user.familyName = assertDisplayName(input.familyName, "familyName");
    }
    if (input.status === "disabled" && user.status !== "disabled") {
      await this.store.transaction(async (store) => {
        await store.lockEffectiveAdmins();
        assertKeepsEffectiveAdmin({
          effectiveAdminUserIds: await store.effectiveAdminUserIds(this.clock.now().toISOString()),
          removingUserIds: [user.id],
        });
        user.status = "disabled";
        await this.bumpAndRevoke(store, user, "user_disabled");
      });
      return user;
    }
    if (input.status === "active") {
      user.status = "active";
    }
    user.updatedAt = this.clock.now().toISOString();
    void actorId;
    await this.store.saveUser(user);
    return user;
  }

  async deleteUser(actorId: string, userId: string): Promise<void> {
    const user = await this.visibleUser(userId);
    await this.store.transaction(async (store) => {
      await store.lockEffectiveAdmins();
      assertKeepsEffectiveAdmin({
        effectiveAdminUserIds: await store.effectiveAdminUserIds(this.clock.now().toISOString()),
        removingUserIds: [user.id],
      });
      const now = this.clock.now().toISOString();
      user.deletedAt = now;
      user.deletedBy = actorId;
      user.status = "disabled";
      user.authorizationVersion += 1;
      user.updatedAt = now;
      await store.saveUser(user);
      await store.retireUserAccess(user.id, now, actorId);
      const sessions = await store.revokeUserSessions(user.id, now, "user_deleted");
      for (const session of sessions) {
        await this.outbox(store, sessionRevoked(session.id, session.userId, "user_deleted"));
      }
      await this.outbox(store, userDeleted(user.id));
    });
  }

  async restoreUser(userId: string): Promise<UserRecord> {
    const user = await this.store.findUserById(userId);
    if (!user || user.deletedAt === null) {
      throw new AccessError("CONFLICT", "El usuario no está eliminado");
    }
    user.deletedAt = null;
    user.deletedBy = null;
    user.status = restoredUserStatus();
    user.updatedAt = this.clock.now().toISOString();
    await this.store.saveUser(user);
    return user;
  }

  async assignRole(actorId: string, userId: string, roleId: string, expiresAt: string | null): Promise<void> {
    if (actorId === userId) {
      throw new AccessError("PERMISSION_DENIED", "No puedes asignarte un rol");
    }
    const role = await this.store.findRole(roleId);
    const target = await this.visibleUser(userId);
    if (!role) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "El rol no está disponible");
    }
    assertCanAssignRole(actorId, target.id, role);
    const now = this.clock.now().toISOString();
    const assignment = {
      id: this.random.uuid(),
      userId: target.id,
      roleId: role.id,
      assignedBy: actorId,
      expiresAt,
      createdAt: now,
      deletedAt: null,
      deletedBy: null,
    };
    await this.store.transaction(async (store) => {
      await store.saveAssignment(assignment);
      target.authorizationVersion += 1;
      target.updatedAt = now;
      await store.saveUser(target);
      const sessions = await store.revokeUserSessions(target.id, now, "role_assigned");
      for (const session of sessions) {
        await this.outbox(store, sessionRevoked(session.id, session.userId, "role_assigned"));
      }
      await this.outbox(store, assignmentChanged(target.id, role.id, assignment.id, "assigned"));
    });
  }

  async revokeAssignment(actorId: string, userId: string, assignmentId: string): Promise<void> {
    const assignment = await this.store.findAssignment(assignmentId);
    if (!assignment || assignment.userId !== userId || assignment.deletedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "La asignación no está disponible");
    }
    const role = await this.store.findRole(assignment.roleId);
    await this.store.transaction(async (store) => {
      await store.lockEffectiveAdmins();
      if (role && role.permissions.includes("users:roles:assign")) {
        assertKeepsEffectiveAdmin({
          effectiveAdminUserIds: await store.effectiveAdminUserIds(this.clock.now().toISOString()),
          removingUserIds: [userId],
        });
      }
      const now = this.clock.now().toISOString();
      assignment.deletedAt = now;
      assignment.deletedBy = actorId;
      await store.saveAssignment(assignment);
      const user = await store.findUserById(userId);
      if (user) {
        user.authorizationVersion += 1;
        user.updatedAt = now;
        await store.saveUser(user);
      }
      const sessions = await store.revokeUserSessions(userId, now, "role_revoked");
      for (const session of sessions) {
        await this.outbox(store, sessionRevoked(session.id, session.userId, "role_revoked"));
      }
      await this.outbox(store, assignmentChanged(userId, assignment.roleId, assignment.id, "revoked"));
    });
  }

  async replacePermissions(actorId: string, roleId: string, version: number, permissionCodes: string[]): Promise<RoleRecord> {
    const actorAssignments = await this.store.activeAssignments(actorId, this.clock.now().toISOString());
    const role = await this.store.findRole(roleId);
    if (!role || role.deletedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "El rol no está disponible");
    }
    if (role.version !== version) {
      throw new AccessError("CONFLICT", "El rol cambió; vuelve a leerlo");
    }
    assertCanReplaceRolePermissions({
      actorRoleIds: actorAssignments.map((item) => item.roleId),
      targetRoleId: role.id,
      system: role.system,
      permissionCodes,
    });
    const previousAdmins = await this.store.effectiveAdminUserIds(this.clock.now().toISOString());
    role.permissions = [...permissionCodes];
    role.version += 1;
    await this.store.transaction(async (store) => {
      await store.lockEffectiveAdmins();
      await store.saveRole(role);
      const holders = await store.bumpUsersForRole(role.id);
      const remaining = await store.effectiveAdminUserIds(this.clock.now().toISOString());
      if (previousAdmins.length > 0 && remaining.length === 0) {
        throw new AccessError("BUSINESS_RULE", "Debe quedar un administrador efectivo");
      }
      const now = this.clock.now().toISOString();
      for (const userId of holders) {
        const sessions = await store.revokeUserSessions(userId, now, "role_permissions");
        for (const session of sessions) {
          await this.outbox(store, sessionRevoked(session.id, session.userId, "role_permissions"));
        }
      }
      await this.outbox(store, roleUpdated(role.id, role.version));
    });
    return role;
  }

  async createRole(applicationId: string, input: { code: string; name: string; description?: string; permissionCodes: string[] }): Promise<RoleRecord> {
    const code = assertRoleCode(input.code);
    if (roleDefinition(code)) {
      throw new AccessError("CONFLICT", "Ese código pertenece a un rol de sistema");
    }
    assertCustomRolePermissions(input.permissionCodes);
    const now = this.clock.now().toISOString();
    const role: RoleRecord = {
      id: this.random.uuid(),
      applicationId,
      code,
      name: input.name.trim(),
      description: input.description ?? "",
      system: false,
      assignableByAccessAdmin: true,
      version: 1,
      permissions: [...input.permissionCodes],
      createdAt: now,
      deletedAt: null,
    };
    await this.store.saveRole(role);
    return role;
  }

  async deleteRole(roleId: string): Promise<void> {
    const role = await this.store.findRole(roleId);
    if (!role || role.deletedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "El rol no está disponible");
    }
    assertSystemRoleUntouched(role.system);
    const active = await this.store.activeAssignmentCount(roleId, this.clock.now().toISOString());
    if (active > 0) {
      throw new AccessError("CONFLICT", "El rol tiene asignaciones activas");
    }
    role.deletedAt = this.clock.now().toISOString();
    await this.store.saveRole(role);
  }

  async configurePasskey(actorId: string, userId: string, action: "enable" | "disable"): Promise<void> {
    const user = await this.visibleUser(userId);
    const policy = await this.store.passkeyPolicy(userId);
    const credentials = await this.store.activePasskeys(userId);
    const now = this.clock.now().toISOString();
    policy.status = action === "enable" ? policyAfterEnable(policy.status, credentials.length) : policyAfterDisable(policy.status);
    policy.enabledAt = action === "enable" ? now : policy.enabledAt;
    await this.store.savePasskeyPolicy(policy);
    await this.bumpAndRevoke(this.store, user, action === "enable" ? "passkey_enabled" : "passkey_disabled");
    void actorId;
  }

  async initiateRecovery(actorId: string, userId: string, reason: string): Promise<{ id: string; status: "pending" }> {
    await this.visibleUser(userId);
    const request = {
      id: this.random.uuid(),
      userId,
      initiatorUserId: actorId,
      reason: reason.trim(),
      status: "pending" as const,
      createdAt: this.clock.now().toISOString(),
    };
    await this.store.saveRecoveryRequest(request);
    return { id: request.id, status: "pending" };
  }

  async updateProfile(user: UserRecord, input: { givenName?: string; familyName?: string; phoneCountryCode?: string; phoneNumber?: string; themePreference?: UserRecord["themePreference"] }): Promise<UserRecord> {
    if (input.givenName === undefined && input.familyName === undefined && input.phoneNumber === undefined && input.themePreference === undefined && input.phoneCountryCode === undefined) {
      throw new AccessError("VALIDATION_ERROR", "Indica un campo permitido");
    }
    if (input.givenName !== undefined) {
      user.givenName = assertDisplayName(input.givenName, "givenName");
    }
    if (input.familyName !== undefined) {
      user.familyName = assertDisplayName(input.familyName, "familyName");
    }
    if (input.phoneCountryCode !== undefined || input.phoneNumber !== undefined) {
      const phone = normalizePhone(input.phoneCountryCode ?? "MX", input.phoneNumber ?? "");
      user.phoneCountryCode = phone.countryCode;
      user.phoneCallingCode = phone.callingCode;
      user.phoneNumber = phone.nationalNumber;
      user.phoneE164 = phone.e164;
    }
    if (input.themePreference !== undefined) {
      user.themePreference = input.themePreference;
    }
    user.updatedAt = this.clock.now().toISOString();
    await this.store.saveUser(user);
    return user;
  }

  async listUsers(permissions: readonly string[], query: PageQuery) {
    this.assertDeletedVisibility(permissions, query, "users:read:deleted");
    return this.store.listUsers(query);
  }

  assertDeletedVisibility(permissions: readonly string[], query: PageQuery, permission: string): void {
    if (query.includeDeleted && !permissions.includes(permission)) {
      throw new AccessError("PERMISSION_DENIED", "No puedes ver registros eliminados");
    }
  }

  listPermissions(): typeof PERMISSIONS {
    return PERMISSIONS;
  }

  async listApplications(permissions: readonly string[], query: PageQuery) {
    this.assertDeletedVisibility(permissions, query, "applications:read:deleted");
    return this.store.listApplications(query);
  }

  async createApplication(input: { code: string; name: string; description?: string }): Promise<ApplicationRecord> {
    const code = assertRoleCode(input.code);
    if (await this.store.findApplicationByCode(code)) {
      throw new AccessError("CONFLICT", "La aplicación ya existe");
    }
    const now = this.clock.now().toISOString();
    const application: ApplicationRecord = {
      id: this.random.uuid(),
      code,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      status: "active",
      createdAt: now,
      deletedAt: null,
    };
    await this.store.saveApplication(application);
    return application;
  }

  async updateApplication(id: string, input: { name?: string; description?: string; status?: "active" | "disabled" }): Promise<ApplicationRecord> {
    const application = await this.visibleApplication(id);
    if (input.name !== undefined) {
      application.name = input.name.trim();
    }
    if (input.description !== undefined) {
      application.description = input.description.trim();
    }
    if (input.status !== undefined) {
      application.status = input.status;
    }
    await this.store.saveApplication(application);
    return application;
  }

  async deleteApplication(id: string): Promise<void> {
    const application = await this.visibleApplication(id);
    application.deletedAt = this.clock.now().toISOString();
    application.status = "disabled";
    await this.store.saveApplication(application);
  }

  async restoreApplication(id: string): Promise<ApplicationRecord> {
    const application = await this.store.findApplication(id);
    if (!application) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "La aplicación no está disponible");
    }
    if (application.deletedAt === null) {
      throw new AccessError("CONFLICT", "La aplicación no está eliminada");
    }
    application.deletedAt = null;
    application.status = "disabled";
    await this.store.saveApplication(application);
    return application;
  }

  async listRoles(applicationId: string, permissions: readonly string[], query: PageQuery) {
    this.assertDeletedVisibility(permissions, query, "roles:read:deleted");
    return this.store.listRoles(applicationId, query);
  }

  async updateRole(roleId: string, input: { name?: string; description?: string }): Promise<RoleRecord> {
    const role = await this.store.findRole(roleId);
    if (!role || role.deletedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "El rol no está disponible");
    }
    assertSystemRoleUntouched(role.system);
    if (input.name !== undefined) {
      role.name = input.name.trim();
    }
    if (input.description !== undefined) {
      role.description = input.description.trim();
    }
    await this.store.saveRole(role);
    return role;
  }

  async restoreRole(roleId: string): Promise<RoleRecord> {
    const role = await this.store.findRole(roleId);
    if (!role) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "El rol no está disponible");
    }
    if (role.deletedAt === null) {
      throw new AccessError("CONFLICT", "El rol no está eliminado");
    }
    role.deletedAt = null;
    await this.store.saveRole(role);
    return role;
  }

  listSessions(userId: string, query: PageQuery) {
    return this.store.listSessions(userId, query);
  }

  listPasskeys(userId: string, query: PageQuery) {
    return this.store.listPasskeys(userId, query);
  }

  listIdentities(userId: string, query: PageQuery) {
    return this.store.listIdentities(userId, query);
  }

  listAssignments(userId: string, query: PageQuery) {
    return this.store.listAssignments(userId, query);
  }

  private async visibleApplication(id: string): Promise<ApplicationRecord> {
    const application = await this.store.findApplication(id);
    if (!application || application.deletedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "La aplicación no está disponible");
    }
    return application;
  }

  private async visibleUser(id: string): Promise<UserRecord> {
    const user = await this.store.findUserById(id);
    if (!user || user.deletedAt !== null) {
      throw new AccessError("RESOURCE_NOT_VISIBLE", "El usuario no está disponible");
    }
    return user;
  }

  private async bumpAndRevoke(store: AccessStore, user: UserRecord, reason: string): Promise<void> {
    user.authorizationVersion += 1;
    user.updatedAt = this.clock.now().toISOString();
    await store.saveUser(user);
    const sessions = await store.revokeUserSessions(user.id, user.updatedAt, reason);
    for (const session of sessions) {
      await this.outbox(store, sessionRevoked(session.id, session.userId, reason));
    }
  }

  private async outbox(store: AccessStore, draft: { eventType: string; aggregateId: string; payload: Record<string, string | number> }): Promise<void> {
    await store.saveOutbox({
      id: this.random.uuid(),
      eventType: draft.eventType,
      aggregateId: draft.aggregateId,
      payload: draft.payload,
      occurredAt: this.clock.now().toISOString(),
      publishedAt: null,
    });
  }
}
