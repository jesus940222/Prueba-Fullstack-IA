export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<"ok" | "limited" | "unavailable">;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
}

export interface OneTimeCode {
  protect(binding: string, code: string): string;
  same(left: string, right: string): boolean;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string; html: string }): Promise<void>;
}

export interface AccessTokenIssuer {
  sign(input: { userId: string; sessionId: string; authorizationVersion: number; restricted: boolean; expiresAt: string }): Promise<string>;
  verify(token: string): Promise<{ userId: string; sessionId: string; authorizationVersion: number; restricted: boolean } | null>;
}

export interface ServiceAuthenticator {
  verify(authorizationHeader: string | undefined, audience?: string): Promise<string | null>;
}

export interface PermissionCache {
  get(key: string): Promise<string[] | null>;
  set(key: string, permissions: string[], ttlSeconds: number): Promise<void>;
}

export interface WebAuthnCeremony {
  configured(): boolean;
  registrationOptions(input: { userId: string; userName: string; challenge: string; excludeCredentialIds: string[] }): Promise<Record<string, unknown>>;
  verifyRegistration(input: { challenge: string; response: Record<string, unknown> }): Promise<{
    credentialId: string;
    publicKey: string;
    signCount: number;
    transports: string[];
    deviceType: string;
    backedUp: boolean;
  } | null>;
  authenticationOptions(input: { challenge: string; credentialIds: string[] }): Promise<Record<string, unknown>>;
  verifyAuthentication(input: {
    challenge: string;
    response: Record<string, unknown>;
    credentialId: string;
    publicKey: string;
    signCount: number;
    transports: string[];
  }): Promise<{ signCount: number } | null>;
}

export interface OidcProvider {
  configured(provider: "google" | "microsoft"): boolean;
  start(input: { provider: "google" | "microsoft"; state: string; nonce: string; verifier: string; returnTo: string }): string;
  exchange(input: { provider: "google" | "microsoft"; code: string; verifier: string; nonce: string }): Promise<
    | { issuer: string; subject: string; audience: string; nonce: string; email: string | null }
    | "invalid"
    | "unavailable"
  >;
}

export interface RandomSource {
  uuid(): string;
  token(bytes: number): string;
  digits(length: number): string;
}

export interface Clock {
  now(): Date;
}

export interface AuthLimits {
  accessTokenTtl: number;
  sessionAbsoluteTtl: number;
  sessionIdleTtl: number;
  emailCodeTtl: number;
  emailCodeAttempts: number;
  recentVerificationTtl: number;
  passwordMinLength: number;
  recoveryCodeCount: number;
  pageDefault: number;
  pageMax: number;
  loginAccountFailures: number;
  loginIpFailures: number;
  loginWindowSeconds: number;
  resendLimit: number;
}
