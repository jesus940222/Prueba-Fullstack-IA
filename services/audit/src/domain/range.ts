import { AuditError } from "./audit-error";

const DAY = 86_400_000;

export interface AuditFilter {
  from: string;
  to: string;
  actorId?: string;
  sourceService?: string;
  eventType?: string;
  resourceType?: string;
  outcome?: "success" | "failure" | "denied";
  correlationId?: string;
}

export function assertRange(input: { from?: string; to?: string; now: Date; maxDays: number }): { from: string; to: string } {
  const to = input.to ? parseInstant(input.to, "to") : input.now.toISOString();
  const from = input.from ? parseInstant(input.from, "from") : new Date(Date.parse(to) - input.maxDays * DAY).toISOString();
  if (Date.parse(from) > Date.parse(to)) {
    throw new AuditError("VALIDATION_ERROR", "El rango de fechas no es válido", [{ field: "from", code: "invalid" }]);
  }
  if (Date.parse(to) - Date.parse(from) > input.maxDays * DAY) {
    throw new AuditError("VALIDATION_ERROR", "El rango de fechas supera el máximo", [{ field: "to", code: "max" }]);
  }
  return { from, to };
}

function parseInstant(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new AuditError("VALIDATION_ERROR", "La fecha no es válida", [{ field, code: "invalid" }]);
  }
  return new Date(parsed).toISOString();
}
