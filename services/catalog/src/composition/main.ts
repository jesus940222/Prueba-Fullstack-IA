import "reflect-metadata";
import type { NextFunction, Request, Response } from "express";
import { NestFactory } from "@nestjs/core";
import { DataSource } from "typeorm";
import { AppModule } from "./app.module";
import { loadEnv } from "../infrastructure/config/env";
import { mountCatalogRuntime } from "../infrastructure/http/runtime";
import { writeLog } from "../infrastructure/logging/write-log";
import { SafeExceptionFilter } from "../presentation/readiness.filter";
import { correlationMiddleware } from "../presentation/correlation.middleware";

function readJsonBody(req: Request, res: Response, next: NextFunction): void {
  if (req.body !== undefined || req.method === "GET" || req.method === "DELETE" || !req.is("application/json")) {
    next();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  req.on("end", () => {
    try {
      const text = Buffer.concat(chunks).toString("utf8");
      req.body = text === "" ? {} : JSON.parse(text) as unknown;
      next();
    } catch {
      const correlationId = res.getHeader("x-correlation-id");
      res.status(422).json({
        code: "VALIDATION_ERROR",
        message: "La solicitud no es válida",
        ...(typeof correlationId === "string" ? { correlationId } : {}),
      });
    }
  });
}

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new SafeExceptionFilter());
  app.use(correlationMiddleware);
  app.use(readJsonBody);
  const server = app.getHttpAdapter().getInstance() as { use: (handler: (req: Request, res: Response, next: NextFunction) => void) => void };
  mountCatalogRuntime(server, env, app.get(DataSource));
  await app.listen(env.port, "0.0.0.0");
  writeLog({ level: "info", event: "listening" });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const errorCode = /^[a-z0-9_:]+$/.test(message) ? message : "startup_failed";
  writeLog({ level: "error", event: "startup_failed", errorCode });
  process.exit(1);
});
