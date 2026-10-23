import { AuditError } from "../domain/audit-error";
import type { Principal } from "./ports";

export function principalFromAuthorize(status: number, body: unknown): Principal {
  if (status === 401) {
    throw new AuditError("SESSION_INVALID", "La sesión no es válida");
  }
  if (status !== 200 || !body || typeof body !== "object") {
    throw new AuditError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión");
  }
  const record = body as { decision?: unknown; reasonCode?: unknown; principal?: { userId?: unknown; sessionId?: unknown } };
  const principal = record.principal;
  if (record.decision === "allow" && typeof principal?.userId === "string" && typeof principal.sessionId === "string") {
    return { userId: principal.userId, sessionId: principal.sessionId };
  }
  throw new AuditError("PERMISSION_DENIED", "No tienes permiso para esta operación");
}
