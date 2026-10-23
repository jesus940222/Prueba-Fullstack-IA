import { z } from "zod";
import { assertPlatformLimits } from "../../domain/platform-limits";

const schema = z.object({
  SERVICE_NAME: z.string().min(1).default("access"),
  SERVICE_VERSION: z.string().min(1).default("0.2.0"),
  PORT: z.string().default("3001"),

  ACCESS_DATABASE_URL: z.string().min(1),
  ACCESS_REDIS_URL: z.string().min(1),
  RABBITMQ_URL: z.string().default(""),
  SMTP_URL: z.string().default(""),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_ACTIVE_KID: z.string().min(1),
  JWT_SIGNING_KEY: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  OTP_HMAC_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default(""),
  MICROSOFT_CLIENT_ID: z.string().default(""),
  MICROSOFT_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_REDIRECT_URI: z.string().default(""),
  MICROSOFT_ALLOWED_ISSUERS: z.string().default(""),
  WEBAUTHN_RP_ID: z.string().default(""),
  WEBAUTHN_ORIGIN: z.string().default(""),
  WEBAUTHN_RP_NAME: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  PASSWORD_MIN_LENGTH: z.string().default("12"),
  RECOVERY_CODE_COUNT: z.string().default("10"),
  LOGIN_ACCOUNT_FAILURES: z.string().default("8"),
  LOGIN_IP_FAILURES: z.string().default("30"),
  LOGIN_WINDOW_SECONDS: z.string().default("900"),
  EMAIL_RESEND_LIMIT: z.string().default("3"),
  PORTAL_PUBLIC_URL: z.string().default("http://localhost:8080"),
  ACCOUNTS_SERVICE_SECRET: z.string().default(""),
  CATALOG_SERVICE_SECRET: z.string().default(""),
  AUDIT_SERVICE_SECRET: z.string().default(""),
  AI_SERVICE_SECRET: z.string().default(""),
  ACCESS_BOOTSTRAP_PASSWORD: z.string().default(""),


  TRANSFER_LIMIT_PER_OPERATION: z.string().default("10000.00"),
  TRANSFER_LIMIT_DAILY: z.string().default("10000.00"),
  TRANSFER_LIMIT_PER_OPERATION_MAX: z.string().default("50000.00"),
  TRANSFER_LIMIT_DAILY_MAX: z.string().default("100000.00"),
  TRANSFER_PROPOSAL_TTL: z.string().default("300"),
  RECENT_VERIFICATION_TTL: z.string().default("300"),
  ACCESS_TOKEN_TTL: z.string().default("600"),
  SESSION_ABSOLUTE_TTL: z.string().default("28800"),
  SESSION_IDLE_TTL: z.string().default("1800"),
  EMAIL_CODE_TTL: z.string().default("300"),
  EMAIL_CODE_MAX_ATTEMPTS: z.string().default("5"),
  PAGE_SIZE_DEFAULT: z.string().default("20"),
  PAGE_SIZE_MAX: z.string().default("100"),
  CURSOR_LIMIT_DEFAULT: z.string().default("20"),
  CURSOR_LIMIT_MAX: z.string().default("50"),
  AI_BUDGET_RUN_USD: z.string().default("1.00"),
  AI_BUDGET_USER_DAY_USD: z.string().default("5.00"),
  AI_BUDGET_GLOBAL_DAY_USD: z.string().default("25.00"),
  AI_BUDGET_WARN_PERCENT: z.string().default("80,100"),
  AI_ALERT_COOLDOWN: z.string().default("1800"),
  AI_MAX_STEPS: z.string().default("8"),
  AI_RUN_TIMEOUT: z.string().default("60"),
  QDRANT_VECTOR_SIZE: z.string().default("3072"),

});


function limitsFrom(data: Record<string, string>) {
  return {
    transferPerOperation: data.TRANSFER_LIMIT_PER_OPERATION,
    transferDaily: data.TRANSFER_LIMIT_DAILY,
    transferPerOperationMax: data.TRANSFER_LIMIT_PER_OPERATION_MAX,
    transferDailyMax: data.TRANSFER_LIMIT_DAILY_MAX,
    proposalTtl: integer(data.TRANSFER_PROPOSAL_TTL),
    recentVerificationTtl: integer(data.RECENT_VERIFICATION_TTL),
    accessTokenTtl: integer(data.ACCESS_TOKEN_TTL),
    sessionAbsoluteTtl: integer(data.SESSION_ABSOLUTE_TTL),
    sessionIdleTtl: integer(data.SESSION_IDLE_TTL),
    emailCodeTtl: integer(data.EMAIL_CODE_TTL),
    emailCodeAttempts: integer(data.EMAIL_CODE_MAX_ATTEMPTS),
    pageDefault: integer(data.PAGE_SIZE_DEFAULT),
    pageMax: integer(data.PAGE_SIZE_MAX),
    cursorDefault: integer(data.CURSOR_LIMIT_DEFAULT),
    cursorMax: integer(data.CURSOR_LIMIT_MAX),
    budgetRun: data.AI_BUDGET_RUN_USD,
    budgetUser: data.AI_BUDGET_USER_DAY_USD,
    budgetGlobal: data.AI_BUDGET_GLOBAL_DAY_USD,
    warnPercents: data.AI_BUDGET_WARN_PERCENT.split(",").map((item) => integer(item)),
    alertCooldown: integer(data.AI_ALERT_COOLDOWN),
    maxSteps: integer(data.AI_MAX_STEPS),
    runTimeout: integer(data.AI_RUN_TIMEOUT),
    vectorSize: integer(data.QDRANT_VECTOR_SIZE),
  };
}

function integer(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid_integer");
  }
  return Number(value);
}


export type AppEnv = ReturnType<typeof loadEnv>;

export function loadEnv(source: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(",");
    throw new Error(`invalid_environment:${fields}`);
  }
  let limits;
  try {
    limits = limitsFrom(parsed.data as unknown as Record<string, string>);
    assertPlatformLimits(limits);
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "invalid_environment";
    throw new Error(code);
  }
  return {
    serviceName: parsed.data.SERVICE_NAME,
    version: parsed.data.SERVICE_VERSION,
    port: integer(parsed.data.PORT),

    databaseUrl: parsed.data.ACCESS_DATABASE_URL,
    redisUrl: parsed.data.ACCESS_REDIS_URL,
    rabbitUrl: parsed.data.RABBITMQ_URL,
    smtpUrl: parsed.data.SMTP_URL,
    bootstrapPassword: parsed.data.ACCESS_BOOTSTRAP_PASSWORD,
    credentials: parsed.data,

  };
}
