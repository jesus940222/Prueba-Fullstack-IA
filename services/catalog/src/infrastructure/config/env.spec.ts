import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("requires the catalog database and allows a missing broker", () => {
    expect(() => loadEnv({})).toThrow("invalid_environment:CATALOG_DATABASE_URL");
    const env = loadEnv({ CATALOG_DATABASE_URL: "postgresql://catalog:local@postgres:5432/catalog" });
    expect(env.rabbitUrl).toBe("");
    expect(env.port).toBe(3003);
  });
});
