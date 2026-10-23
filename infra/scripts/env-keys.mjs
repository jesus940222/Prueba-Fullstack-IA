export const SECRET_KEYS = [
  "POSTGRES_SUPERUSER_PASSWORD",
  "ACCESS_DB_PASSWORD",
  "ACCOUNTS_DB_PASSWORD",
  "CATALOG_DB_PASSWORD",
  "AI_DB_PASSWORD",
  "REDIS_PASSWORD",
  "RABBITMQ_ADMIN_PASSWORD",
  "RABBITMQ_ACCESS_PASSWORD",
  "RABBITMQ_ACCOUNTS_PASSWORD",
  "RABBITMQ_CATALOG_PASSWORD",
  "RABBITMQ_AUDIT_PASSWORD",
  "RABBITMQ_AI_PASSWORD",
  "MONGO_ROOT_PASSWORD",
  "AUDIT_CONSUMER_PASSWORD",
  "AUDIT_API_PASSWORD",
  "AUDIT_MIGRATOR_PASSWORD",
  "JWT_SIGNING_KEY",
  "CSRF_SECRET",
  "OTP_HMAC_SECRET",
  "ACCOUNTS_SERVICE_SECRET",
  "CATALOG_SERVICE_SECRET",
  "AUDIT_SERVICE_SECRET",
  "AI_SERVICE_SECRET",
  "ACCESS_BOOTSTRAP_PASSWORD",
];

export const EXTERNAL_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_ALLOWED_ISSUERS",
  "OPENAI_API_KEY",
  "LANGSMITH_API_KEY",
];

export const SECRET_URL_KEYS = [
  "ACCESS_DATABASE_URL",
  "ACCOUNTS_DATABASE_URL",
  "CATALOG_DATABASE_URL",
  "AI_DATABASE_URL",
  "ACCESS_REDIS_URL",
  "RABBITMQ_ACCESS_URL",
  "RABBITMQ_ACCOUNTS_URL",
  "RABBITMQ_CATALOG_URL",
  "RABBITMQ_AUDIT_URL",
  "RABBITMQ_AI_URL",
  "AUDIT_CONSUMER_URL",
  "AUDIT_API_URL",
  "AUDIT_MIGRATOR_URL",
];

export const PUBLIC_ENTRIES = [
  ["POSTGRES_USER", "portal_admin"],
  ["MONGO_ROOT_USER", "portal_admin"],
  ["RABBITMQ_ADMIN_USER", "portal_admin"],
  ["RABBITMQ_ACCESS_USER", "access"],
  ["RABBITMQ_ACCOUNTS_USER", "accounts"],
  ["RABBITMQ_CATALOG_USER", "catalog"],
  ["RABBITMQ_AUDIT_USER", "audit"],
  ["RABBITMQ_AI_USER", "ai"],
  ["JWT_ISSUER", "http://localhost:8080"],
  ["JWT_AUDIENCE", "portal-local"],
  ["JWT_ACTIVE_KID", "local-1"],
  ["WEBAUTHN_RP_ID", "localhost"],
  ["WEBAUTHN_ORIGIN", "http://localhost:8080"],
  ["WEBAUTHN_RP_NAME", "Portal local"],
  ["GOOGLE_REDIRECT_URI", "http://localhost:8080/api/v1/access/auth/oidc/google/callback"],
  ["MICROSOFT_REDIRECT_URI", "http://localhost:8080/api/v1/access/auth/oidc/microsoft/callback"],
  ["SMTP_URL", "smtp://mailpit:1025"],
  ["QDRANT_URL", "http://qdrant:6333"],
  ["QDRANT_COLLECTION", "knowledge"],
  ["OPENAI_CONVERSATION_MODEL", "gpt-6-luna"],
  ["OPENAI_EMBEDDING_MODEL", "text-embedding-3-large"],
  ["OPENAI_PRICE_INPUT_PER_MILLION", "0.10"],
  ["OPENAI_PRICE_CACHED_INPUT_PER_MILLION", "0.01"],
  ["OPENAI_PRICE_CACHE_WRITE_PER_MILLION", "0.125"],
  ["OPENAI_PRICE_OUTPUT_PER_MILLION", "0.50"],
  ["OPENAI_PRICE_EMBEDDING_PER_MILLION", "0.13"],
  ["OPENAI_PRICE_OBSERVED_ON", "2026-10-21"],
  ["LANGSMITH_TRACING", "false"],
  ["LANGSMITH_ENDPOINT", ""],
  ["LANGSMITH_PROJECT", ""],
  ["LANGSMITH_WORKSPACE_ID", ""],
  ["FINANCIAL_CURRENCY", "MXN"],
  ["FINANCIAL_TIME_ZONE", "America/Mexico_City"],
  ["PHONE_DEFAULT_REGION", "MX"],
  ["PHONE_DEFAULT_CALLING_CODE", "+52"],
  ["TRANSFER_LIMIT_PER_OPERATION", "10000.00"],
  ["TRANSFER_LIMIT_DAILY", "10000.00"],
  ["TRANSFER_LIMIT_PER_OPERATION_MAX", "50000.00"],
  ["TRANSFER_LIMIT_DAILY_MAX", "100000.00"],
  ["TRANSFER_PROPOSAL_TTL", "300"],
  ["RECENT_VERIFICATION_TTL", "300"],
  ["ACCESS_TOKEN_TTL", "600"],
  ["SESSION_ABSOLUTE_TTL", "28800"],
  ["SESSION_IDLE_TTL", "1800"],
  ["EMAIL_CODE_TTL", "300"],
  ["EMAIL_CODE_MAX_ATTEMPTS", "5"],
  ["PAGE_SIZE_DEFAULT", "20"],
  ["PAGE_SIZE_MAX", "100"],
  ["CURSOR_LIMIT_DEFAULT", "20"],
  ["CURSOR_LIMIT_MAX", "50"],
  ["AI_BUDGET_RUN_USD", "1.00"],
  ["AI_BUDGET_USER_DAY_USD", "5.00"],
  ["AI_BUDGET_GLOBAL_DAY_USD", "25.00"],
  ["AI_BUDGET_WARN_PERCENT", "80,100"],
  ["AI_ALERT_COOLDOWN", "1800"],
  ["AI_MAX_STEPS", "8"],
  ["AI_RUN_TIMEOUT", "60"],
  ["AI_MAX_TOTAL_TOKENS", "8000"],
  ["AI_CHAT_RATE_LIMIT", "20"],
  ["AI_CHAT_RATE_WINDOW", "60"],
  ["AI_MAX_CONCURRENCY", "2"],
  ["AI_BUDGET_RESERVE_USD", "0.05"],
  ["QDRANT_VECTOR_SIZE", "3072"],
  ["CONCEPT_MAX_LENGTH", "140"],
  ["ACCOUNT_NUMBER_PATTERN", "^[0-9]{10,18}$"],
  ["PASSWORD_MIN_LENGTH", "12"],
  ["RECOVERY_CODE_COUNT", "10"],
  ["DISPLAY_NAME_MAX_LENGTH", "80"],
  ["AUDIT_RANGE_MAX_DAYS", "31"],
  ["SERVICE_VERSION", "0.2.0"],
];

export function exampleText() {
  const lines = [
    "# Plantilla sin secretos. Crear el entorno local con: pnpm env:local",
    "# Ese comando se niega a sobrescribir un .env existente.",
    "# Las tarifas de OpenAI se leyeron el 2026-10-21 y siguen siendo provisionales.",
    ...SECRET_KEYS.map((key) => `${key}=`),
    ...EXTERNAL_KEYS.map((key) => `${key}=`),
    ...SECRET_URL_KEYS.map((key) => `${key}=`),
    ...PUBLIC_ENTRIES.map(([key, value]) => `${key}=${value}`),
    "",
  ];
  return lines.join("\n");
}

export function parseEnv(text) {
  const values = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      throw new Error("invalid_env_line");
    }
    values.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  return values;
}
