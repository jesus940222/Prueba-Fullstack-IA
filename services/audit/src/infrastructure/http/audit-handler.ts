import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AuditWorkflows } from "../../application/audit-workflows";
import { AuditError, httpStatusFor } from "../../domain/audit-error";
import { pageResult, parsePageQuery } from "../../domain/pagination";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export interface AuditHttpDependencies {
  workflows: AuditWorkflows;
  pageDefault: number;
  pageMax: number;
}

export interface AuditHttpRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  cookie: string | undefined;
  correlationId: string;
}

export interface AuditHttpResult {
  status: number;
  body?: unknown;
  headers: Record<string, string>;
}

export async function handleAudit(deps: AuditHttpDependencies, request: AuditHttpRequest): Promise<AuditHttpResult> {
  try {
    if (request.method !== "GET") {
      return json(404, { code: "RESOURCE_NOT_VISIBLE", message: "La ruta no está disponible", correlationId: request.correlationId });
    }
    const matched = match(request.path);
    if (!matched) {
      return json(404, { code: "RESOURCE_NOT_VISIBLE", message: "La ruta no está disponible", correlationId: request.correlationId });
    }
    return await matched.run(deps, request, matched.params);
  } catch (error) {
    if (error instanceof AuditError) {
      return json(httpStatusFor(error.code), {
        code: error.code,
        message: error.message,
        correlationId: request.correlationId,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      });
    }
    return json(500, { code: "UNEXPECTED_FAILURE", message: "No se pudo completar la operación", correlationId: request.correlationId });
  }
}

export function mountAudit(app: { use: (handler: (req: Request, res: Response, next: NextFunction) => void) => void }, deps: AuditHttpDependencies): void {
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/v1/audit")) {
      next();
      return;
    }
    const correlation = res.getHeader("x-correlation-id");
    void handleAudit(deps, {
      method: req.method,
      path: req.path,
      query: req.query as Record<string, unknown>,
      cookie: req.header("cookie"),
      correlationId: typeof correlation === "string" ? correlation : "00000000-0000-4000-8000-000000000000",
    }).then((result) => {
      if (result.body === undefined) {
        res.status(result.status).end();
        return;
      }
      res.status(result.status).json(result.body);
    }).catch(() => {
      if (!res.headersSent) {
        res.status(500).json({ code: "UNEXPECTED_FAILURE" });
      }
    });
  });
}

const ROUTES: Array<{ pattern: RegExp; run: (deps: AuditHttpDependencies, request: AuditHttpRequest, params: Record<string, string>) => Promise<AuditHttpResult> }> = [
  { pattern: /^\/api\/v1\/audit\/events$/, run: list },
  { pattern: /^\/api\/v1\/audit\/events\/(?<id>[0-9a-f-]{36})$/i, run: detail },
  { pattern: /^\/api\/v1\/audit\/me\/events$/, run: own },
  { pattern: /^\/api\/v1\/audit\/correlations\/(?<id>[0-9a-f-]{36})\/events$/i, run: correlation },
];

function match(path: string) {
  for (const candidate of ROUTES) {
    const found = candidate.pattern.exec(path);
    if (found) {
      return { params: found.groups ?? {}, run: candidate.run };
    }
  }
  return null;
}

async function list(deps: AuditHttpDependencies, request: AuditHttpRequest): Promise<AuditHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.list(session(request), filters(request), query, request.correlationId);
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function detail(deps: AuditHttpDependencies, request: AuditHttpRequest, params: Record<string, string>): Promise<AuditHttpResult> {
  return json(200, await deps.workflows.get(session(request), params.id ?? "", request.correlationId));
}

async function own(deps: AuditHttpDependencies, request: AuditHttpRequest): Promise<AuditHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listOwn(session(request), filters(request), query, request.correlationId);
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function correlation(deps: AuditHttpDependencies, request: AuditHttpRequest, params: Record<string, string>): Promise<AuditHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listCorrelation(session(request), params.id ?? "", query, request.correlationId);
  return json(200, pageResult(found.items, found.totalItems, query));
}

function filters(request: AuditHttpRequest) {
  const actor = optional(request.query.actorId, uuid, "actorId");
  const source = optional(request.query.sourceService, z.enum(["access", "accounts", "catalog", "audit", "ai"]), "sourceService");
  const eventType = optional(request.query.eventType, z.string().min(1).max(80), "eventType");
  const resourceType = optional(request.query.resourceType, z.string().min(1).max(80), "resourceType");
  const outcome = optional(request.query.outcome, z.enum(["success", "failure", "denied"]), "outcome");
  const from = optional(request.query.from, z.string().min(1), "from");
  const to = optional(request.query.to, z.string().min(1), "to");
  return { from, to, actorId: actor, sourceService: source, eventType, resourceType, outcome };
}

function optional<T>(value: unknown, schema: z.ZodType<T>, field: string): T | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AuditError("VALIDATION_ERROR", "El filtro no es válido", [{ field, code: "invalid" }]);
  }
  return parsed.data;
}

function page(deps: AuditHttpDependencies, request: AuditHttpRequest) {
  return parsePageQuery({ ...request.query, pageDefault: deps.pageDefault, pageMax: deps.pageMax });
}

function session(request: AuditHttpRequest): string {
  if (!request.cookie) {
    return "";
  }
  for (const part of request.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "portal_session") {
      return decodeURIComponent(rest.join("="));
    }
  }
  return "";
}

function json(status: number, body: unknown): AuditHttpResult {
  return { status, body, headers: {} };
}
