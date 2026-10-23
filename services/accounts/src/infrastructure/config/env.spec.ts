import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("requires the accounts database and allows a missing broker", () => {
    expect(() => loadEnv({})).toThrow("invalid_environment:ACCOUNTS_DATABASE_URL");
    const env = loadEnv({ ACCOUNTS_DATABASE_URL: "postgresql://accounts:local@postgres:5432/accounts" });
    expect(env.rabbitUrl).toBe("");
    expect(env.port).toBe(3002);
    expect(() => loadEnv({ ACCOUNTS_DATABASE_URL: "postgresql://accounts:local@postgres:5432/accounts", FINANCIAL_TIME_ZONE: "UTC" })).toThrow("invalid_time_zone");
    expect(() => loadEnv({ ACCOUNTS_DATABASE_URL: "postgresql://accounts:local@postgres:5432/accounts", RESOLVE_RATE_LIMIT: "0" })).toThrow("invalid_resolve_rate");
    expect(() => loadEnv({ ACCOUNTS_DATABASE_URL: "postgresql://accounts:local@postgres:5432/accounts", PORT: "nope" })).toThrow("invalid_integer");
  });
});
