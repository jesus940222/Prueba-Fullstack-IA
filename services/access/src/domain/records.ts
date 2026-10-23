export type UserStatus = "invited" | "active" | "disabled";
export type ThemePreference = "light" | "dark" | "system";
export type PasskeyStatus = "disabled" | "pending" | "active";

export interface UserRecord {
  id: string;
  email: string;
  emailNormalized: string;
  emailVerifiedAt: string | null;
  givenName: string;
  familyName: string;
  status: UserStatus;
  authorizationVersion: number;
  themePreference: ThemePreference;
  phoneCountryCode: string | null;
  phoneCallingCode: string | null;
  phoneNumber: string | null;
  phoneE164: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

export interface PasswordRecord {
  id: string;
  userId: string;
  passwordHash: string;
  changedAt: string;
  revokedAt: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  applicationCode: string;
  authenticationMethod: string;
  verifiedAt: string;
  authorizationVersion: number;
  restricted: boolean;
  csrfHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
}

export interface RefreshRecord {
  id: string;
  sessionId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  replacedById: string | null;
}

export interface ChallengeRecord {
  id: string;
  userId: string;
  purpose: "email_login" | "passkey_login" | "passkey_enrollment" | "password_reset" | "invitation";
  verifierHash: string;
  attemptCount: number;
  expiresAt: string;
  consumedAt: string | null;
  invalidatedAt: string | null;
  binding: string;
}

export interface PasskeyRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface PasskeyPolicyRecord {
  userId: string;
  status: PasskeyStatus;
  enabledAt: string | null;
  activatedAt: string | null;
}

export interface IdentityRecord {
  id: string;
  userId: string;
  provider: "google" | "microsoft";
  issuer: string;
  subject: string;
  linkedAt: string;
  revokedAt: string | null;
}

export interface RecoveryCodeRecord {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export interface RecoveryRequestRecord {
  id: string;
  userId: string;
  initiatorUserId: string;
  reason: string;
  status: "pending";
  createdAt: string;
}

export interface RoleRecord {
  id: string;
  applicationId: string;
  code: string;
  name: string;
  description: string;
  system: boolean;
  assignableByAccessAdmin: boolean;
  version: number;
  permissions: string[];
  createdAt: string;
  deletedAt: string | null;
}

export interface AssignmentRecord {
  id: string;
  userId: string;
  roleId: string;
  assignedBy: string;
  expiresAt: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

export interface ApplicationRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  status: "active" | "disabled";
  createdAt: string;
  deletedAt: string | null;
}

export interface OidcTransactionRecord {
  id: string;
  stateHash: string;
  nonceHash: string;
  verifier: string;
  provider: "google" | "microsoft";
  intent: "login" | "link";
  userId: string | null;
  returnTo: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OutboxRecord {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, string | number>;
  occurredAt: string;
  publishedAt: string | null;
}
