export const ACCESS_ERROR_CODES = [
  "SESSION_INVALID",
  "PERMISSION_DENIED",
  "RESOURCE_NOT_VISIBLE",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "VALIDATION_ERROR",
  "BUSINESS_RULE",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
  "CSRF_INVALID",
  "RECENT_VERIFICATION_REQUIRED",
  "RECOVERY_POLICY_DISABLED",
  "CHALLENGE_INVALID",
] as const;

export type AccessErrorCode = (typeof ACCESS_ERROR_CODES)[number];

export interface FieldError {
  field: string;
  code: string;
}

export class AccessError extends Error {
  readonly fieldErrors?: FieldError[];

  constructor(
    readonly code: AccessErrorCode,
    message: string,
    fieldErrors?: FieldError[],
  ) {
    super(message);
    this.name = "AccessError";
    this.fieldErrors = fieldErrors;
  }
}

export function httpStatusFor(code: AccessErrorCode): number {
  switch (code) {
    case "SESSION_INVALID":
      return 401;
    case "CSRF_INVALID":
    case "PERMISSION_DENIED":
      return 403;
    case "RESOURCE_NOT_VISIBLE":
      return 404;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "DEPENDENCY_UNAVAILABLE":
      return 503;
    default:
      return 422;
  }
}
