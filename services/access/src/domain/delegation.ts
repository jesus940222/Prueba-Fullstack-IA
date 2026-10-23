import { AccessError } from "./access-error";
import { EFFECTIVE_ADMIN_PERMISSION, isDelegablePermission, isKnownPermission } from "./catalog";

export interface AssignableRole {
  id: string;
  code: string;
  system: boolean;
  assignableByAccessAdmin: boolean;
  permissions: readonly string[];
  deletedAt: string | null;
}

export function assertCanAssignRole(actorUserId: string, targetUserId: string, role: AssignableRole): void {
  if (role.deletedAt !== null) {
    throw new AccessError("RESOURCE_NOT_VISIBLE", "El rol no está disponible");
  }
  if (actorUserId === targetUserId) {
    throw new AccessError("PERMISSION_DENIED", "No puedes asignarte un rol");
  }
  if (role.system) {
    if (!role.assignableByAccessAdmin) {
      throw new AccessError("PERMISSION_DENIED", "Ese rol de sistema no se puede asignar");
    }
    return;
  }
  for (const code of role.permissions) {
    if (!isDelegablePermission(code)) {
      throw new AccessError("BUSINESS_RULE", "El rol incluye un permiso que no se puede delegar");
    }
  }
}

export function assertCustomRolePermissions(permissionCodes: readonly string[]): void {
  const seen = new Set<string>();
  for (const code of permissionCodes) {
    if (seen.has(code) || !isKnownPermission(code) || !isDelegablePermission(code)) {
      throw new AccessError("BUSINESS_RULE", "El rol personalizado solo admite permisos delegables");
    }
    seen.add(code);
  }
}

export function assertCanReplaceRolePermissions(input: {
  actorRoleIds: readonly string[];
  targetRoleId: string;
  system: boolean;
  permissionCodes: readonly string[];
}): void {
  if (input.system) {
    throw new AccessError("BUSINESS_RULE", "Un rol de sistema no cambia sus permisos");
  }
  if (input.actorRoleIds.includes(input.targetRoleId)) {
    throw new AccessError("PERMISSION_DENIED", "No puedes editar un rol que tienes asignado");
  }
  assertCustomRolePermissions(input.permissionCodes);
}

export function assertKeepsEffectiveAdmin(input: {
  effectiveAdminUserIds: readonly string[];
  removingUserIds: readonly string[];
}): void {
  const removing = new Set(input.removingUserIds);
  const remaining = input.effectiveAdminUserIds.filter((userId) => !removing.has(userId));
  if (remaining.length < 1) {
    throw new AccessError("BUSINESS_RULE", "Debe quedar un administrador efectivo");
  }
}

export function roleGrantsEffectiveAdmin(permissions: readonly string[]): boolean {
  return permissions.includes(EFFECTIVE_ADMIN_PERMISSION);
}

export function assertSystemRoleUntouched(system: boolean): void {
  if (system) {
    throw new AccessError("BUSINESS_RULE", "Un rol de sistema no se modifica");
  }
}
