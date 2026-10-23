import { AccessError } from "./access-error";
import type { SessionVerdict } from "./session-policy";

export interface AuthorizationDecision {
  decision: "allow" | "deny";
  reasonCode: string;
}

export function decideAuthorization(input: {
  databaseAvailable: boolean;
  verdict: SessionVerdict;
  restricted: boolean;
  permission: string;
  granted: ReadonlySet<string>;
}): AuthorizationDecision {
  if (!input.databaseAvailable) {
    throw new AccessError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la autorización");
  }
  if (input.verdict !== "valid") {
    return { decision: "deny", reasonCode: input.verdict };
  }
  if (input.restricted) {
    return { decision: "deny", reasonCode: "restricted_session" };
  }
  if (!input.granted.has(input.permission)) {
    return { decision: "deny", reasonCode: "permission" };
  }
  return { decision: "allow", reasonCode: "authorized" };
}

export function sessionInvalid(verdict: SessionVerdict): boolean {
  return verdict !== "valid";
}
