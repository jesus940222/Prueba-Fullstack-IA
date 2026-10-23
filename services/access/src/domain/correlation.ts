const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveCorrelationId(raw: string | undefined, next: () => string): string {
  const value = raw?.trim() ?? "";
  if (UUID_V4.test(value)) {
    return value.toLowerCase();
  }
  return next();
}
