export type SessionVerdict = "valid" | "revoked" | "expired" | "idle" | "version_mismatch" | "user_inactive";

export interface SessionSnapshot {
  revokedAt: string | null;
  expiresAt: string;
  lastSeenAt: string;
  authorizationVersion: number;
  restricted: boolean;
}

export interface UserAccessSnapshot {
  status: "invited" | "active" | "disabled";
  deletedAt: string | null;
  authorizationVersion: number;
}

export function assessSession(input: {
  session: SessionSnapshot;
  user: UserAccessSnapshot;
  now: Date;
  idleSeconds: number;
}): SessionVerdict {
  if (input.session.revokedAt !== null) {
    return "revoked";
  }
  if (input.user.deletedAt !== null || input.user.status !== "active") {
    return "user_inactive";
  }
  if (Date.parse(input.session.expiresAt) <= input.now.getTime()) {
    return "expired";
  }
  if (input.now.getTime() - Date.parse(input.session.lastSeenAt) > input.idleSeconds * 1000) {
    return "idle";
  }
  if (input.session.authorizationVersion !== input.user.authorizationVersion) {
    return "version_mismatch";
  }
  return "valid";
}

export type RefreshVerdict = "rotate" | "reuse" | "revoked" | "expired";

export function assessRefresh(input: {
  usedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
  now: Date;
}): RefreshVerdict {
  if (input.usedAt !== null) {
    return "reuse";
  }
  if (input.revokedAt !== null) {
    return "revoked";
  }
  if (Date.parse(input.expiresAt) <= input.now.getTime()) {
    return "expired";
  }
  return "rotate";
}

export function sessionExpiry(now: Date, absoluteSeconds: number): string {
  return new Date(now.getTime() + absoluteSeconds * 1000).toISOString();
}

export function isRecentlyVerified(verifiedAt: string, now: Date, ttlSeconds: number): boolean {
  return now.getTime() - Date.parse(verifiedAt) <= ttlSeconds * 1000;
}
