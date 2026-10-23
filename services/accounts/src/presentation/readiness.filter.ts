import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { UnavailableReadiness } from "../application/readiness";

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof UnavailableReadiness) {
      response.status(503).json(exception.report);
      return;
    }
    response.status(500).json({ code: "UNEXPECTED_FAILURE" });
  }
}
