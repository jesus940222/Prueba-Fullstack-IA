import { loadEnv } from "./env";

const secret = "a".repeat(32);

function base(): NodeJS.ProcessEnv {
  return {
    ACCESS_DATABASE_URL: "postgresql://access:local@postgres:5432/access",
    ACCESS_REDIS_URL: "redis://redis:6379/0",
    JWT_ISSUER: "http://localhost:8080",
    JWT_AUDIENCE: "portal-local",
    JWT_ACTIVE_KID: "local-1",
    JWT_SIGNING_KEY: secret,
    CSRF_SECRET: secret,
    OTP_HMAC_SECRET: secret,
  };
}

describe("loadEnv", () => {
  it("fails closed when the database URL is missing", () => {
    const source = base();
    delete source.ACCESS_DATABASE_URL;
    expect(() => loadEnv(source)).toThrow("invalid_environment:ACCESS_DATABASE_URL");
  });

  it("does not include a rejected secret in the error", () => {
    expect(() => loadEnv({ ...base(), CSRF_SECRET: "short-secret" })).toThrow(/^invalid_environment:CSRF_SECRET$/);
  });

  it("accepts empty external credentials", () => {
    const env = loadEnv(base());
    expect(env.credentials.GOOGLE_CLIENT_ID).toBe("");
    expect(env.credentials.OPENAI_API_KEY).toBe("");
    expect(env.port).toBe(3001);
  });
});
