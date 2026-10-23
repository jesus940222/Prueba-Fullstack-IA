import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { CatalogWorkflows, CategoryWrite, OfferWrite, ProductWrite, RuleWrite } from "../../application/catalog-workflows";
import { CatalogError, httpStatusFor } from "../../domain/catalog-error";
import { pageResult, parsePageQuery } from "../../domain/pagination";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const code = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const name = z.string().trim().min(1).max(80);
const attribute = z.union([z.string(), z.number(), z.boolean()]);

const categoryWrite = z.object({
  code,
  name,
  description: z.string().max(500).optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).strict();

const productWrite = z.object({
  categoryId: uuid,
  code,
  name,
  summary: z.string().max(300).optional(),
  description: z.string().max(4000).optional(),
  currency: z.literal("MXN"),
  termsText: z.string().max(8000).optional(),
  status: z.enum(["draft", "active", "disabled"]).optional(),
  conditions: z.object({
    schemaVersion: z.number().int().min(1),
    attributes: z.record(z.string(), attribute),
  }).strict().optional(),
}).strict();

const offerWrite = z.object({
  productId: uuid,
  code,
  title: name,
  description: z.string().max(4000).optional(),
  benefitType: z.literal("information").optional(),
  benefitValue: z.string().max(200).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  audienceType: z.enum(["general", "rules", "direct"]),
  status: z.enum(["draft", "active", "disabled"]).optional(),
}).strict();

const rulesWrite = z.object({
  rules: z.array(z.object({
    field: z.enum(["totalBalance", "accountAgeDays"]),
    operator: z.enum(["eq", "gte", "lte"]),
    value: z.string().max(40),
  }).strict()).max(10),
}).strict();

export interface CatalogHttpDependencies {
  workflows: CatalogWorkflows;
  pageDefault: number;
  pageMax: number;
}

export interface CatalogHttpRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  cookie: string | undefined;
  csrf: string | undefined;
  correlationId: string;
}

export interface CatalogHttpResult {
  status: number;
  body?: unknown;
  headers: Record<string, string>;
}

export async function handleCatalog(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  try {
    const matched = match(request.method, request.path);
    if (!matched) {
      return json(404, { code: "RESOURCE_NOT_VISIBLE", message: "La ruta no está disponible", correlationId: request.correlationId });
    }
    if (matched.csrf) {
      assertCsrf(request);
    }
    return await matched.run(deps, request, matched.params);
  } catch (error) {
    if (error instanceof CatalogError) {
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

export function mountCatalog(app: { use: (handler: (req: Request, res: Response, next: NextFunction) => void) => void }, deps: CatalogHttpDependencies): void {
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/v1/catalog")) {
      next();
      return;
    }
    const correlation = res.getHeader("x-correlation-id");
    void handleCatalog(deps, {
      method: req.method,
      path: req.path,
      query: req.query as Record<string, unknown>,
      body: req.body,
      cookie: req.header("cookie"),
      csrf: req.header("x-csrf-token"),
      correlationId: typeof correlation === "string" ? correlation : "00000000-0000-4000-8000-000000000000",
    }).then((result) => {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
      }
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

type Route = (deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>) => Promise<CatalogHttpResult>;

const ROUTES: Array<{ method: string; pattern: RegExp; csrf: boolean; run: Route }> = [
  { method: "GET", pattern: /^\/api\/v1\/catalog\/categories$/, csrf: false, run: publicCategories },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/products$/, csrf: false, run: publicProducts },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/products\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: publicProduct },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/me\/offers$/, csrf: false, run: myOffers },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/me\/offers\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: myOffer },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/customers\/(?<customerId>[0-9a-f-]{36})\/offers$/i, csrf: false, run: customerOffers },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/admin\/categories$/, csrf: false, run: adminCategories },
  { method: "POST", pattern: /^\/api\/v1\/catalog\/admin\/categories$/, csrf: true, run: createCategory },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/admin\/categories\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: adminCategory },
  { method: "PATCH", pattern: /^\/api\/v1\/catalog\/admin\/categories\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: updateCategory },
  { method: "DELETE", pattern: /^\/api\/v1\/catalog\/admin\/categories\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: deleteCategory },
  { method: "POST", pattern: /^\/api\/v1\/catalog\/admin\/categories\/(?<id>[0-9a-f-]{36})\/restore$/i, csrf: true, run: restoreCategory },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/admin\/products$/, csrf: false, run: adminProducts },
  { method: "POST", pattern: /^\/api\/v1\/catalog\/admin\/products$/, csrf: true, run: createProduct },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/admin\/products\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: adminProduct },
  { method: "PATCH", pattern: /^\/api\/v1\/catalog\/admin\/products\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: updateProduct },
  { method: "DELETE", pattern: /^\/api\/v1\/catalog\/admin\/products\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: deleteProduct },
  { method: "POST", pattern: /^\/api\/v1\/catalog\/admin\/products\/(?<id>[0-9a-f-]{36})\/restore$/i, csrf: true, run: restoreProduct },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/admin\/offers$/, csrf: false, run: adminOffers },
  { method: "POST", pattern: /^\/api\/v1\/catalog\/admin\/offers$/, csrf: true, run: createOffer },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/admin\/offers\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: adminOffer },
  { method: "PATCH", pattern: /^\/api\/v1\/catalog\/admin\/offers\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: updateOffer },
  { method: "DELETE", pattern: /^\/api\/v1\/catalog\/admin\/offers\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: deleteOffer },
  { method: "POST", pattern: /^\/api\/v1\/catalog\/admin\/offers\/(?<id>[0-9a-f-]{36})\/restore$/i, csrf: true, run: restoreOffer },
  { method: "PUT", pattern: /^\/api\/v1\/catalog\/admin\/offers\/(?<id>[0-9a-f-]{36})\/eligibility-rules$/i, csrf: true, run: replaceRules },
  { method: "GET", pattern: /^\/api\/v1\/catalog\/admin\/offers\/(?<id>[0-9a-f-]{36})\/assignments$/i, csrf: false, run: assignments },
  { method: "POST", pattern: /^\/api\/v1\/catalog\/admin\/offers\/(?<id>[0-9a-f-]{36})\/assignments$/i, csrf: true, run: createAssignment },
  { method: "DELETE", pattern: /^\/api\/v1\/catalog\/admin\/offers\/(?<id>[0-9a-f-]{36})\/assignments\/(?<assignmentId>[0-9a-f-]{36})$/i, csrf: true, run: deleteAssignment },
];

function match(method: string, path: string) {
  for (const candidate of ROUTES) {
    if (candidate.method !== method) {
      continue;
    }
    const found = candidate.pattern.exec(path);
    if (found) {
      return { csrf: candidate.csrf, params: found.groups ?? {}, run: candidate.run };
    }
  }
  return null;
}

async function publicCategories(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listPublicCategories(session(request), query);
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function publicProducts(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listPublicProducts(session(request), query, optionalUuid(request.query.categoryId, "categoryId"));
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function publicProduct(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  return json(200, await deps.workflows.getPublicProduct(session(request), params.id ?? ""));
}

async function myOffers(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listMyOffers(session(request), query);
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function myOffer(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  return json(200, await deps.workflows.getMyOffer(session(request), params.id ?? ""));
}

async function customerOffers(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listCustomerOffers(session(request), params.customerId ?? "", query);
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function adminCategories(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listAdminCategories(session(request), query, deletedFlag(request));
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function createCategory(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  return json(201, await deps.workflows.createCategory(session(request), parse(categoryWrite, request.body) as CategoryWrite));
}

async function adminCategory(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  return json(200, await deps.workflows.getAdminCategory(session(request), params.id ?? ""));
}

async function updateCategory(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  return json(200, await deps.workflows.updateCategory(session(request), params.id ?? "", parse(categoryWrite, request.body) as CategoryWrite));
}

async function deleteCategory(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  await deps.workflows.deleteCategory(session(request), params.id ?? "");
  return empty(204);
}

async function restoreCategory(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  parse(z.object({}).strict(), request.body ?? {});
  return json(200, await deps.workflows.restoreCategory(session(request), params.id ?? ""));
}

async function adminProducts(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listAdminProducts(session(request), query, deletedFlag(request));
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function createProduct(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  return json(201, await deps.workflows.createProduct(session(request), parse(productWrite, request.body) as ProductWrite, request.correlationId));
}

async function adminProduct(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  return json(200, await deps.workflows.getAdminProduct(session(request), params.id ?? ""));
}

async function updateProduct(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  return json(200, await deps.workflows.updateProduct(session(request), params.id ?? "", parse(productWrite, request.body) as ProductWrite, request.correlationId));
}

async function deleteProduct(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  await deps.workflows.deleteProduct(session(request), params.id ?? "", request.correlationId);
  return empty(204);
}

async function restoreProduct(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  parse(z.object({}).strict(), request.body ?? {});
  return json(200, await deps.workflows.restoreProduct(session(request), params.id ?? "", request.correlationId));
}

async function adminOffers(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listAdminOffers(session(request), query, deletedFlag(request));
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function createOffer(deps: CatalogHttpDependencies, request: CatalogHttpRequest): Promise<CatalogHttpResult> {
  return json(201, await deps.workflows.createOffer(session(request), parse(offerWrite, request.body) as OfferWrite, request.correlationId));
}

async function adminOffer(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  return json(200, await deps.workflows.getAdminOffer(session(request), params.id ?? ""));
}

async function updateOffer(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  return json(200, await deps.workflows.updateOffer(session(request), params.id ?? "", parse(offerWrite, request.body) as OfferWrite, request.correlationId));
}

async function deleteOffer(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  await deps.workflows.deleteOffer(session(request), params.id ?? "", request.correlationId);
  return empty(204);
}

async function restoreOffer(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  parse(z.object({}).strict(), request.body ?? {});
  return json(200, await deps.workflows.restoreOffer(session(request), params.id ?? "", request.correlationId));
}

async function replaceRules(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  const body = parse(rulesWrite, request.body);
  return json(200, await deps.workflows.replaceRules(session(request), params.id ?? "", body.rules as RuleWrite[], request.correlationId));
}

async function assignments(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listAssignments(session(request), params.id ?? "", query);
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function createAssignment(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  const body = parse(z.object({ customerId: uuid, reason: z.string().min(1).max(300) }).strict(), request.body);
  return json(201, await deps.workflows.createAssignment(session(request), params.id ?? "", body.customerId, body.reason, request.correlationId));
}

async function deleteAssignment(deps: CatalogHttpDependencies, request: CatalogHttpRequest, params: Record<string, string>): Promise<CatalogHttpResult> {
  await deps.workflows.deleteAssignment(session(request), params.id ?? "", params.assignmentId ?? "", request.correlationId);
  return empty(204);
}

function page(deps: CatalogHttpDependencies, request: CatalogHttpRequest) {
  return parsePageQuery({ ...request.query, pageDefault: deps.pageDefault, pageMax: deps.pageMax });
}

function deletedFlag(request: CatalogHttpRequest): boolean {
  const value = request.query.includeDeleted;
  if (value === undefined || value === "" || value === "false" || value === false) {
    return false;
  }
  if (value === "true" || value === true) {
    return true;
  }
  throw new CatalogError("VALIDATION_ERROR", "El indicador de eliminados no es válido", [{ field: "includeDeleted", code: "invalid" }]);
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw new CatalogError("VALIDATION_ERROR", "El identificador no es válido", [{ field, code: "invalid" }]);
  }
  return parsed.data;
}

function session(request: CatalogHttpRequest): string {
  return readCookie(request.cookie, "portal_session") ?? "";
}

function assertCsrf(request: CatalogHttpRequest): void {
  const cookie = readCookie(request.cookie, "portal_csrf");
  if (!cookie || !request.csrf || cookie.length !== request.csrf.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(request.csrf))) {
    throw new CatalogError("CSRF_INVALID", "La verificación CSRF no es válida");
  }
}

function readCookie(header: string | undefined, cookieName: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === cookieName) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new CatalogError("VALIDATION_ERROR", "La solicitud no es válida", parsed.error.issues.slice(0, 8).map((issue) => ({
      field: issue.path.join(".") || "body",
      code: "invalid",
    })));
  }
  return parsed.data;
}

function json(status: number, body: unknown): CatalogHttpResult {
  return { status, body, headers: {} };
}

function empty(status: number): CatalogHttpResult {
  return { status, headers: {} };
}
