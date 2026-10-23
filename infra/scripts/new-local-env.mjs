import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { EXTERNAL_KEYS, PUBLIC_ENTRIES, SECRET_KEYS, SECRET_URL_KEYS } from "./env-keys.mjs";

const target = new URL("../../.env", import.meta.url);

if (existsSync(target)) {
  process.stderr.write("env_exists\n");
  process.exit(1);
}

const secret = () => randomBytes(24).toString("hex");
const secrets = Object.fromEntries(SECRET_KEYS.map((key) => [key, secret()]));

function url(user, password, host, path) {
  return `postgresql://${user}:${password}@${host}/${path}`;
}

const generated = {
  ACCESS_DATABASE_URL: url("access", secrets.ACCESS_DB_PASSWORD, "postgres:5432", "access"),
  ACCOUNTS_DATABASE_URL: url("accounts", secrets.ACCOUNTS_DB_PASSWORD, "postgres:5432", "accounts"),
  CATALOG_DATABASE_URL: url("catalog", secrets.CATALOG_DB_PASSWORD, "postgres:5432", "catalog"),
  AI_DATABASE_URL: url("ai", secrets.AI_DB_PASSWORD, "postgres:5432", "ai"),
  ACCESS_REDIS_URL: `redis://:${secrets.REDIS_PASSWORD}@redis:6379/0`,
  RABBITMQ_ACCESS_URL: `amqp://access:${secrets.RABBITMQ_ACCESS_PASSWORD}@rabbitmq:5672/`,
  RABBITMQ_ACCOUNTS_URL: `amqp://accounts:${secrets.RABBITMQ_ACCOUNTS_PASSWORD}@rabbitmq:5672/`,
  RABBITMQ_CATALOG_URL: `amqp://catalog:${secrets.RABBITMQ_CATALOG_PASSWORD}@rabbitmq:5672/`,
  RABBITMQ_AUDIT_URL: `amqp://audit:${secrets.RABBITMQ_AUDIT_PASSWORD}@rabbitmq:5672/`,
  RABBITMQ_AI_URL: `amqp://ai:${secrets.RABBITMQ_AI_PASSWORD}@rabbitmq:5672/`,
  AUDIT_CONSUMER_URL: `mongodb://audit_consumer:${secrets.AUDIT_CONSUMER_PASSWORD}@mongo:27017/audit?authSource=audit`,
  AUDIT_API_URL: `mongodb://audit_api:${secrets.AUDIT_API_PASSWORD}@mongo:27017/audit?authSource=audit`,
  AUDIT_MIGRATOR_URL: `mongodb://audit_migrator:${secrets.AUDIT_MIGRATOR_PASSWORD}@mongo:27017/audit?authSource=audit`,
};

const missing = SECRET_URL_KEYS.filter((key) => generated[key] === undefined);
if (missing.length > 0) {
  process.stderr.write("missing_url_builder\n");
  process.exit(1);
}

const lines = [
  ...SECRET_KEYS.map((key) => `${key}=${secrets[key]}`),
  ...EXTERNAL_KEYS.map((key) => `${key}=`),
  ...SECRET_URL_KEYS.map((key) => `${key}=${generated[key]}`),
  ...PUBLIC_ENTRIES.map(([key, value]) => `${key}=${value}`),
  "",
];
writeFileSync(target, lines.join("\n"), { encoding: "utf8" });
process.stdout.write("env_written\n");
