import { AccessError } from "./access-error";

export type PasskeyPolicyStatus = "disabled" | "pending" | "active";

export function policyAfterEnable(current: PasskeyPolicyStatus, activeCredentials: number): PasskeyPolicyStatus {
  if (current === "active") {
    return "active";
  }
  return activeCredentials > 0 ? "active" : "pending";
}

export function policyAfterRegistration(current: PasskeyPolicyStatus): PasskeyPolicyStatus {
  if (current === "disabled") {
    throw new AccessError("BUSINESS_RULE", "La política de passkey no está habilitada");
  }
  return "active";
}

export function policyAfterDisable(current: PasskeyPolicyStatus): PasskeyPolicyStatus {
  if (current === "disabled") {
    return "disabled";
  }
  return "disabled";
}

export function assertCanRevokeCredential(policy: PasskeyPolicyStatus, activeCredentials: number): void {
  if (policy === "active" && activeCredentials <= 1) {
    throw new AccessError("BUSINESS_RULE", "No se desactiva la passkey al revocar la última credencial");
  }
}

export function assertCounter(stored: number, presented: number): number {
  if (presented === 0 && stored === 0) {
    return 0;
  }
  if (presented > stored) {
    return presented;
  }
  throw new AccessError("CHALLENGE_INVALID", "La credencial no superó la comprobación");
}
