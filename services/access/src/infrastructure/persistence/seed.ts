import { createHash } from "node:crypto";
import type { DataSource } from "typeorm";
import { PERMISSIONS, ROLES } from "../../domain/catalog";
import { writeLog } from "../logging/write-log";
import { createPasswordHasher } from "../security/password-hasher";

const PEOPLE = [
  ["ana.cliente@portal.local", "Ana", "Cliente", "cliente"],
  ["bruno.soporte@portal.local", "Bruno", "Soporte", "soporte"],
  ["carla.auditor@portal.local", "Carla", "Auditor", "auditor"],
  ["diego.admin@portal.local", "Diego", "Admin", "administrador"],
  ["elena.gestor@portal.local", "Elena", "Gestor", "gestor-catalogo"],
] as const;

export async function seedAccess(dataSource: DataSource, bootstrapPassword: string): Promise<void> {
  const now = new Date().toISOString();
  const applicationId = stableId("application:portal");
  await dataSource.query(
    `INSERT INTO applications (id, code, name, description, status, created_at)
     VALUES ($1, 'portal', 'Portal', 'Aplicación local', 'active', $2)
     ON CONFLICT (code) DO NOTHING`,
    [applicationId, now],
  );
  for (const permission of PERMISSIONS) {
    await dataSource.query(
      `INSERT INTO permissions (id, application_id, code, description, resource, action, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO NOTHING`,
      [stableId(`permission:${permission.code}`), applicationId, permission.code, permission.code, permission.resource, permission.action, permission.scope],
    );
  }
  for (const role of ROLES) {
    const roleId = stableId(`role:${role.code}`);
    await dataSource.query(
      `INSERT INTO roles (id, application_id, code, name, description, system, assignable_by_access_admin, version, created_at)
       VALUES ($1, $2, $3, $4, '', true, $5, 1, $6)
       ON CONFLICT (application_id, code) DO NOTHING`,
      [roleId, applicationId, role.code, role.code, role.assignableByAccessAdmin, now],
    );
    for (const code of role.permissions) {
      await dataSource.query(
        `INSERT INTO role_permissions (id, role_id, permission_id)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = $2 AND permission_id = $3)`,
        [stableId(`role-permission:${role.code}:${code}`), roleId, stableId(`permission:${code}`)],
      );
    }
  }
  const passwordHash = bootstrapPassword === "" ? null : await createPasswordHasher().hash(bootstrapPassword);
  if (passwordHash === null) {
    writeLog({ level: "info", event: "bootstrap_password_missing" });
  }
  for (const [email, givenName, familyName, roleCode] of PEOPLE) {
    const userId = stableId(`user:${email}`);
    await dataSource.query(
      `INSERT INTO users (
         id, email, email_normalized, email_verified_at, given_name, family_name, status,
         authorization_version, theme_preference, created_at, updated_at
       ) VALUES ($1, $2, $2, $3, $4, $5, 'active', 1, 'system', $3, $3)
       ON CONFLICT (email_normalized) DO NOTHING`,
      [userId, email, now, givenName, familyName],
    );
    if (passwordHash !== null) {
      await dataSource.query(
        `INSERT INTO password_credentials (id, user_id, password_hash, changed_at)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (SELECT 1 FROM password_credentials WHERE user_id = $2)`,
        [stableId(`password:${email}`), userId, passwordHash, now],
      );
    }
    await dataSource.query(
      `INSERT INTO passkey_policies (user_id, status) SELECT $1, 'disabled'
       WHERE NOT EXISTS (SELECT 1 FROM passkey_policies WHERE user_id = $1)`,
      [userId],
    );
    await dataSource.query(
      `INSERT INTO user_roles (id, user_id, role_id, created_at)
       SELECT $1, $2, $3, $4
       WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $2 AND role_id = $3)`,
      [stableId(`assignment:${email}:${roleCode}`), userId, stableId(`role:${roleCode}`), now],
    );
  }
}

function stableId(name: string): string {
  const hex = createHash("sha256").update(`portal:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
