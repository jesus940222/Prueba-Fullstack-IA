const audit = db.getSiblingDB("audit");

function ensureRole(name, actions) {
  if (!audit.getRole(name)) {
    audit.createRole({
      role: name,
      privileges: [{ resource: { db: "audit", collection: "events" }, actions }],
      roles: [],
    });
  }
}

function ensureUser(name, password, role) {
  const roles = [{ role, db: "audit" }];
  if (!audit.getUser(name)) {
    audit.createUser({ user: name, pwd: password, roles });
  } else {
    audit.updateUser(name, { pwd: password, roles });
  }
}

ensureRole("audit_insert", ["insert"]);
ensureRole("audit_find_insert", ["find", "insert"]);
ensureRole("audit_migrate", ["find", "insert", "createIndex", "listIndexes"]);
ensureUser("audit_consumer", process.env.AUDIT_CONSUMER_PASSWORD, "audit_insert");
ensureUser("audit_api", process.env.AUDIT_API_PASSWORD, "audit_find_insert");
ensureUser("audit_migrator", process.env.AUDIT_MIGRATOR_PASSWORD, "audit_migrate");
