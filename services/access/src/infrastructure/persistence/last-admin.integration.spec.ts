import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DirectoryWorkflows } from "../../application/directory-workflows";
import { AccessError } from "../../domain/access-error";
import { assertKeepsEffectiveAdmin } from "../../domain/delegation";
import { Baseline1730000000000 } from "./baseline.migration";
import { PostgresAccessStore } from "./postgres-access-store";
import { AccessSchema1732000000000 } from "./schema.migration";

const gateUrl = process.env.ACCESS_GATE_DATABASE_URL ?? "";
const gate = gateUrl === "" ? describe.skip : describe;

function sourceFor(url: string): DataSource {
  return new DataSource({
    type: "postgres",
    url,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    migrations: [Baseline1730000000000, AccessSchema1732000000000],
    extra: { max: 4 },
  });
}

function directory(store: PostgresAccessStore): DirectoryWorkflows {
  return new DirectoryWorkflows(
    store,
    { uuid: () => randomUUID(), token: () => randomUUID(), digits: () => "000000" },
    { now: () => new Date() },
    { protect: (binding, code) => `${binding}:${code}`, same: (left, right) => left === right },
    { async send() { return undefined; } },
    "http://localhost:8080",
    300,
  );
}

async function seedAdmins(source: DataSource, label: string): Promise<{ leftUserId: string; rightUserId: string; leftAssignmentId: string; rightAssignmentId: string }> {
  const store = new PostgresAccessStore(source);
  const now = new Date().toISOString();
  const applicationId = randomUUID();
  await source.query(
    `INSERT INTO applications (id, code, name, description, status, created_at)
     VALUES ($1, $2, 'Gate', '', 'active', $3)`,
    [applicationId, `gate-${label}`, now],
  );
  await source.query(
    `INSERT INTO permissions (id, application_id, code, description, resource, action, scope)
     VALUES ($1, $2, 'users:roles:assign', '', 'role-assignments', 'assign', 'any')`,
    [randomUUID(), applicationId],
  );
  const roleId = randomUUID();
  await store.saveRole({
    id: roleId,
    applicationId,
    code: "administrador-gate",
    name: "Administrador de la prueba",
    description: "",
    system: false,
    assignableByAccessAdmin: true,
    version: 1,
    permissions: ["users:roles:assign"],
    createdAt: now,
    deletedAt: null,
  });
  const leftUserId = randomUUID();
  const rightUserId = randomUUID();
  for (const [id, email] of [[leftUserId, `left-${label}@gate.local`], [rightUserId, `right-${label}@gate.local`]] as const) {
    await store.saveUser({
      id,
      email,
      emailNormalized: email,
      emailVerifiedAt: now,
      givenName: "Gate",
      familyName: "Admin",
      status: "active",
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
    });
  }
  const leftAssignmentId = randomUUID();
  const rightAssignmentId = randomUUID();
  await store.saveAssignment({ id: leftAssignmentId, userId: leftUserId, roleId, assignedBy: leftUserId, expiresAt: null, createdAt: now, deletedAt: null, deletedBy: null });
  await store.saveAssignment({ id: rightAssignmentId, userId: rightUserId, roleId, assignedBy: rightUserId, expiresAt: null, createdAt: now, deletedAt: null, deletedBy: null });
  return { leftUserId, rightUserId, leftAssignmentId, rightAssignmentId };
}

gate("last administrator concurrency", () => {
  const left = sourceFor(gateUrl);
  const right = sourceFor(gateUrl);

  beforeAll(async () => {
    await left.initialize();
    await right.initialize();
    await left.runMigrations();
  });

  afterAll(async () => {
    if (left.isInitialized) {
      await left.destroy();
    }
    if (right.isInitialized) {
      await right.destroy();
    }
  });

  beforeEach(async () => {
    await left.query(`TRUNCATE TABLE
      outbox_events, oidc_transactions, recovery_requests, recovery_codes, external_identities,
      passkey_credentials, passkey_policies, auth_challenges, refresh_tokens, sessions, user_roles,
      role_permissions, roles, permissions, password_credentials, users, applications
      RESTART IDENTITY CASCADE`);
  });

  it("keeps one effective administrator when two revocations overlap on the transaction lock", async () => {
    const seeded = await seedAdmins(left, "overlap");
    let active = 0;
    let maxActive = 0;
    async function revoke(source: DataSource, userId: string, assignmentId: string): Promise<void> {
      const store = new PostgresAccessStore(source);
      await store.transaction(async (tx) => {
        await tx.lockEffectiveAdmins();
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 400));
        assertKeepsEffectiveAdmin({
          effectiveAdminUserIds: await tx.effectiveAdminUserIds(new Date().toISOString()),
          removingUserIds: [userId],
        });
        const assignment = await tx.findAssignment(assignmentId);
        if (!assignment) {
          throw new Error("missing_assignment");
        }
        assignment.deletedAt = new Date().toISOString();
        assignment.deletedBy = userId;
        await tx.saveAssignment(assignment);
        active -= 1;
      });
    }

    const results = await Promise.allSettled([
      revoke(left, seeded.leftUserId, seeded.leftAssignmentId),
      revoke(right, seeded.rightUserId, seeded.rightAssignmentId),
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    expect(maxActive).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ reason: expect.any(AccessError) });
    expect((failures[0] as PromiseRejectedResult).reason).toMatchObject({ code: "BUSINESS_RULE" });
    expect(await new PostgresAccessStore(left).effectiveAdminUserIds(new Date().toISOString())).toHaveLength(1);
  }, 20000);

  it("rejects one of two concurrent assignment revocations through the directory workflow", async () => {
    const seeded = await seedAdmins(left, "workflow");
    const results = await Promise.allSettled([
      directory(new PostgresAccessStore(left)).revokeAssignment(seeded.rightUserId, seeded.leftUserId, seeded.leftAssignmentId),
      directory(new PostgresAccessStore(right)).revokeAssignment(seeded.leftUserId, seeded.rightUserId, seeded.rightAssignmentId),
    ]);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(AccessError);
    expect(rejected[0]?.reason).toMatchObject({ code: "BUSINESS_RULE" });
    expect(await new PostgresAccessStore(left).effectiveAdminUserIds(new Date().toISOString())).toHaveLength(1);
  }, 20000);
});
