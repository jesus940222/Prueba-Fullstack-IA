import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { UnavailableReadiness } from "../application/readiness";
import { AccessError, httpStatusFor } from "../domain/access-error";

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof UnavailableReadiness) {
      response.status(503).json(exception.report);
      return;
    }
    if (exception instanceof AccessError) {
      const correlationId = typeof response.getHeader === "function" ? response.getHeader("x-correlation-id") : undefined;
      response.status(httpStatusFor(exception.code)).json({
        code: exception.code,
        message: exception.message,
        ...(typeof correlationId === "string" ? { correlationId } : {}),
        ...(exception.fieldErrors ? { fieldErrors: exception.fieldErrors } : {}),
      });
      return;
    }
    response.status(500).json({ code: "UNEXPECTED_FAILURE" });
  }
}
