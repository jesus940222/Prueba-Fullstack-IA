const ALLOWED = ["level", "event", "correlationId", "statusCode", "method", "path", "dependency", "errorCode"] as const;

export interface LogInput {
  level: "info" | "error";
  event: string;
  correlationId?: string;
  statusCode?: number;
  method?: string;
  path?: string;
  dependency?: string;
  errorCode?: string;
}

export function toLogRecord(input: LogInput, service: string, version: string): Record<string, unknown> {
  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: input.level,
    service,
    version,
    event: input.event,
  };
  for (const key of ALLOWED) {
    if (key === "level" || key === "event") {
      continue;
    }
    const value = input[key];
    if (value !== undefined) {
      record[key] = value;
    }
  }
  return record;
}

export function writeLog(input: LogInput): void {
  const record = toLogRecord(input, process.env.SERVICE_NAME ?? "unknown", process.env.SERVICE_VERSION ?? "0.2.0");
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
