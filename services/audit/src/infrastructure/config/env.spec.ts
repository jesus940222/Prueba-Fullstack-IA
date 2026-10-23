import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("requires separate API and migration URLs", () => {
    expect(() => loadEnv({ AUDIT_API_URL: "mongodb://audit_api:local@mongo:27017/audit" })).toThrow(
      "invalid_environment:AUDIT_MIGRATOR_URL",
    );
    const env = loadEnv({
      AUDIT_API_URL: "mongodb://audit_api:local@mongo:27017/audit",
      AUDIT_MIGRATOR_URL: "mongodb://audit_migrator:local@mongo:27017/audit",
    });
    expect(env.port).toBe(3004);
    expect(env.migratorUrl).toContain("audit_migrator");
  });
});
