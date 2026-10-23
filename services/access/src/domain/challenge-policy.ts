export type ChallengePurpose = "email_login" | "passkey_login" | "passkey_enrollment" | "password_reset" | "invitation" | "recovery_code";

export type ProofVerdict = "accepted" | "expired" | "consumed" | "invalidated" | "locked" | "mismatch" | "purpose";

export function assessProof(input: {
  purpose: ChallengePurpose;
  expectedPurpose: ChallengePurpose;
  expiresAt: string;
  consumedAt: string | null;
  invalidatedAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  now: Date;
  proofMatches: boolean;
}): ProofVerdict {
  if (input.purpose !== input.expectedPurpose) {
    return "purpose";
  }
  if (input.consumedAt !== null) {
    return "consumed";
  }
  if (input.invalidatedAt !== null) {
    return "invalidated";
  }
  if (Date.parse(input.expiresAt) <= input.now.getTime()) {
    return "expired";
  }
  if (input.attemptCount >= input.maxAttempts) {
    return "locked";
  }
  if (!input.proofMatches) {
    return input.attemptCount + 1 >= input.maxAttempts ? "locked" : "mismatch";
  }
  return "accepted";
}

export function nextAttemptCount(verdict: ProofVerdict, current: number): number {
  if (verdict === "mismatch" || verdict === "locked") {
    return current + 1;
  }
  return current;
}
