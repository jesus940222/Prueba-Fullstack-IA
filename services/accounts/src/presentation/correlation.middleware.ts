import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { resolveCorrelationId } from "../application/correlation";
import { writeLog } from "../infrastructure/logging/write-log";

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("x-correlation-id") ?? undefined;
  const correlationId = resolveCorrelationId(header, () => randomUUID());
  res.setHeader("x-correlation-id", correlationId);
  res.on("finish", () => {
    writeLog({
      level: "info",
      event: "request",
      correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
    });
  });
  next();
}
