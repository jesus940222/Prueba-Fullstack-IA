export const AUDIT_ERROR_CODES = [
  "SESSION_INVALID",
  "PERMISSION_DENIED",
  "RESOURCE_NOT_VISIBLE",
  "CONFLICT",
  "VALIDATION_ERROR",
  "BUSINESS_RULE",
  "DEPENDENCY_UNAVAILABLE",
  "CSRF_INVALID",
] as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

export interface FieldError {
  field: string;
  code: string;
}

export class AuditError extends Error {
  readonly fieldErrors?: FieldError[];

  constructor(readonly code: AuditErrorCode, message: string, fieldErrors?: FieldError[]) {
    super(message);
    this.name = "AuditError";
    this.fieldErrors = fieldErrors;
  }
}

export function httpStatusFor(code: AuditErrorCode): number {
  switch (code) {
    case "SESSION_INVALID":
      return 401;
    case "CSRF_INVALID":
    case "PERMISSION_DENIED":
      return 403;
    case "RESOURCE_NOT_VISIBLE":
      return 404;
    case "CONFLICT":
      return 409;
    case "DEPENDENCY_UNAVAILABLE":
      return 503;
    default:
      return 422;
  }
}
