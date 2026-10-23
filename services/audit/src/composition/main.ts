import "reflect-metadata";
import type { NextFunction, Request, Response } from "express";
import { NestFactory } from "@nestjs/core";
import { getConnectionToken } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { AppModule } from "./app.module";
import { loadEnv } from "../infrastructure/config/env";
import { mountAuditRuntime } from "../infrastructure/http/runtime";
import { writeLog } from "../infrastructure/logging/write-log";
import { SafeExceptionFilter } from "../presentation/readiness.filter";
import { correlationMiddleware } from "../presentation/correlation.middleware";

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new SafeExceptionFilter());
  app.use(correlationMiddleware);
  const server = app.getHttpAdapter().getInstance() as { use: (handler: (req: Request, res: Response, next: NextFunction) => void) => void };
  mountAuditRuntime(server, env, app.get<Connection>(getConnectionToken()));
  await app.listen(env.port, "0.0.0.0");
  writeLog({ level: "info", event: "listening" });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const errorCode = /^[a-z0-9_]+$/.test(message) ? message : "startup_failed";
  writeLog({ level: "error", event: "startup_failed", errorCode });
  process.exit(1);
});
