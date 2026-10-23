import type { DataSource } from "typeorm";
import { AuthWorkflows } from "../../application/auth-workflows";
import { DirectoryWorkflows } from "../../application/directory-workflows";
import type { AppEnv } from "../config/env";
import { startOutboxPublisher } from "../messaging/outbox-publisher";
import { createSmtpMailer } from "../mail/smtp-mailer";
import { PostgresAccessStore } from "../persistence/postgres-access-store";
import { createOidcClient } from "../security/oidc-client";
import { createOneTimeCode } from "../security/one-time-code";
import { createPasswordHasher } from "../security/password-hasher";
import { createRandomSource } from "../security/random-source";
import { createRedisGuards } from "../security/redis-guards";
import { createServiceAuthenticator } from "../security/service-authenticator";
import { SigningKeys } from "../security/access-tokens";
import { createWebAuthn } from "../security/webauthn-ceremony";
import { mountAccess, type AccessHttpDependencies } from "./access-handler";

export async function mountAccessRuntime(app: Parameters<typeof mountAccess>[0], env: AppEnv, dataSource: DataSource): Promise<() => void> {
  const store = new PostgresAccessStore(dataSource);
  const keys = new SigningKeys(dataSource, env.credentials.JWT_SIGNING_KEY, env.credentials.JWT_ACTIVE_KID, env.credentials.JWT_ISSUER, env.credentials.JWT_AUDIENCE);
  const guards = createRedisGuards(env.redisUrl);
  const limits = {
    accessTokenTtl: integer(env.credentials.ACCESS_TOKEN_TTL),
    sessionAbsoluteTtl: integer(env.credentials.SESSION_ABSOLUTE_TTL),
    sessionIdleTtl: integer(env.credentials.SESSION_IDLE_TTL),
    emailCodeTtl: integer(env.credentials.EMAIL_CODE_TTL),
    emailCodeAttempts: integer(env.credentials.EMAIL_CODE_MAX_ATTEMPTS),
    recentVerificationTtl: integer(env.credentials.RECENT_VERIFICATION_TTL),
    passwordMinLength: integer(env.credentials.PASSWORD_MIN_LENGTH),
    recoveryCodeCount: integer(env.credentials.RECOVERY_CODE_COUNT),
    pageDefault: integer(env.credentials.PAGE_SIZE_DEFAULT),
    pageMax: integer(env.credentials.PAGE_SIZE_MAX),
    loginAccountFailures: integer(env.credentials.LOGIN_ACCOUNT_FAILURES),
    loginIpFailures: integer(env.credentials.LOGIN_IP_FAILURES),
    loginWindowSeconds: integer(env.credentials.LOGIN_WINDOW_SECONDS),
    resendLimit: integer(env.credentials.EMAIL_RESEND_LIMIT),
  };
  const random = createRandomSource();
  const clock = { now: () => new Date() };
  const codes = createOneTimeCode(env.credentials.OTP_HMAC_SECRET);
  const mailer = createSmtpMailer(env.smtpUrl);
  const auth = new AuthWorkflows({
    store,
    passwords: createPasswordHasher(),
    codes,
    mailer,
    tokens: await keys.createIssuer(),
    webauthn: createWebAuthn({
      rpId: env.credentials.WEBAUTHN_RP_ID,
      origin: env.credentials.WEBAUTHN_ORIGIN,
      rpName: env.credentials.WEBAUTHN_RP_NAME,
    }),
    oidc: createOidcClient({
      google: {
        clientId: env.credentials.GOOGLE_CLIENT_ID,
        clientSecret: env.credentials.GOOGLE_CLIENT_SECRET,
        redirectUri: env.credentials.GOOGLE_REDIRECT_URI,
        allowedIssuers: ["https://accounts.google.com"],
      },
      microsoft: {
        clientId: env.credentials.MICROSOFT_CLIENT_ID,
        clientSecret: env.credentials.MICROSOFT_CLIENT_SECRET,
        redirectUri: env.credentials.MICROSOFT_REDIRECT_URI,
        allowedIssuers: env.credentials.MICROSOFT_ALLOWED_ISSUERS.split(",").map((item) => item.trim()).filter((item) => item !== ""),
      },
    }),
    rates: guards.rates,
    random,
    clock,
    limits,
    portalUrl: env.credentials.PORTAL_PUBLIC_URL,
    cache: guards.cache,
  });
  const directory = new DirectoryWorkflows(store, random, clock, codes, mailer, env.credentials.PORTAL_PUBLIC_URL, limits.emailCodeTtl);
  const http: AccessHttpDependencies = {
    auth,
    directory,
    store,
    services: createServiceAuthenticator({
      accounts: env.credentials.ACCOUNTS_SERVICE_SECRET,
      catalog: env.credentials.CATALOG_SERVICE_SECRET,
      audit: env.credentials.AUDIT_SERVICE_SECRET,
      ai: env.credentials.AI_SERVICE_SECRET,
    }),
    jwks: () => keys.jwks(),
    pageDefault: limits.pageDefault,
    pageMax: limits.pageMax,
    accessTokenTtl: limits.accessTokenTtl,
    sessionAbsoluteTtl: limits.sessionAbsoluteTtl,
    recentVerificationTtl: limits.recentVerificationTtl,
    now: () => clock.now(),
  };
  mountAccess(app, http);
  const stopOutbox = startOutboxPublisher(store, env.rabbitUrl);
  return () => {
    stopOutbox();
    guards.close();
  };
}

function integer(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid_integer");
  }
  return Number(value);
}
