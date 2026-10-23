import { AccessError } from "./access-error";

export const RECOVERY_POLICY_ENABLED = false;

export function assertRecoveryCompletionAllowed(
  initiatorUserId: string,
  completerUserId: string,
  enabled: boolean = RECOVERY_POLICY_ENABLED,
): void {
  if (!enabled) {
    throw new AccessError("RECOVERY_POLICY_DISABLED", "La recuperación administrativa está cerrada");
  }
  if (initiatorUserId === completerUserId) {
    throw new AccessError("BUSINESS_RULE", "Quien inicia la recuperación no puede completarla");
  }
}

export function restoredUserStatus(): "disabled" {
  return "disabled";
}
