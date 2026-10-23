import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AccountsWorkflows } from "../../application/accounts-workflows";
import { AccountsError, httpStatusFor } from "../../domain/accounts-error";
import { pageResult, parsePageQuery } from "../../domain/pagination";
import { assertEligibilityCaller } from "./eligibility-auth";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const money = z.string().regex(/^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/);

export interface AccountsHttpDependencies {
  workflows: AccountsWorkflows;
  pageDefault: number;
  pageMax: number;
  cursorDefault: number;
  cursorMax: number;
  eligibilitySecrets: { catalog: string; ai: string };
}

export interface AccountsHttpRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  cookie: string | undefined;
  csrf: string | undefined;
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  correlationId: string;
}

export interface AccountsHttpResult {
  status: number;
  body?: unknown;
  headers: Record<string, string>;
}

export async function handleAccounts(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
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
    if (error instanceof AccountsError) {
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

export function mountAccounts(app: { use: (handler: (req: Request, res: Response, next: NextFunction) => void) => void }, deps: AccountsHttpDependencies): void {
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/v1/accounts") && req.path !== "/internal/v1/accounts/eligibility-context" && req.path !== "/internal/v1/accounts/customer-link") {
      next();
      return;
    }
    const correlation = res.getHeader("x-correlation-id");
    void handleAccounts(deps, {
      method: req.method,
      path: req.path,
      query: req.query as Record<string, unknown>,
      body: req.body,
      cookie: req.header("cookie"),
      csrf: req.header("x-csrf-token"),
      authorization: req.header("authorization"),
      idempotencyKey: req.header("idempotency-key"),
      correlationId: typeof correlation === "string" ? correlation : "00000000-0000-4000-8000-000000000000",
    }).then((result) => {
      for (const [name, value] of Object.entries(result.headers)) {
        res.setHeader(name, value);
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

type Route = (deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>) => Promise<AccountsHttpResult>;

const ROUTES: Array<{ method: string; pattern: RegExp; csrf: boolean; run: Route }> = [
  { method: "GET", pattern: /^\/api\/v1\/accounts\/summary$/, csrf: false, run: summary },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/accounts$/, csrf: false, run: accounts },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/accounts\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: account },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/accounts\/(?<id>[0-9a-f-]{36})\/movements$/i, csrf: false, run: movements },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/transfers$/, csrf: false, run: transfers },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/transfers\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: transfer },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/transfers\/(?<id>[0-9a-f-]{36})\/receipt$/i, csrf: false, run: receipt },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/beneficiaries$/, csrf: false, run: beneficiaries },
  { method: "POST", pattern: /^\/api\/v1\/accounts\/beneficiaries$/, csrf: true, run: createBeneficiary },
  { method: "PATCH", pattern: /^\/api\/v1\/accounts\/beneficiaries\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: renameBeneficiary },
  { method: "DELETE", pattern: /^\/api\/v1\/accounts\/beneficiaries\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: deleteBeneficiary },
  { method: "POST", pattern: /^\/api\/v1\/accounts\/recipients\/resolve$/, csrf: true, run: resolveRecipient },
  { method: "POST", pattern: /^\/api\/v1\/accounts\/transfer-proposals$/, csrf: true, run: createProposal },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/transfer-proposals\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: proposal },
  { method: "DELETE", pattern: /^\/api\/v1\/accounts\/transfer-proposals\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: cancelProposal },
  { method: "POST", pattern: /^\/api\/v1\/accounts\/transfer-proposals\/(?<id>[0-9a-f-]{36})\/confirm$/i, csrf: true, run: confirmProposal },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/me\/transfer-limits$/, csrf: false, run: limits },
  { method: "PATCH", pattern: /^\/api\/v1\/accounts\/me\/transfer-limits$/, csrf: true, run: updateLimits },
  { method: "POST", pattern: /^\/internal\/v1\/accounts\/eligibility-context$/, csrf: false, run: eligibility },
  { method: "POST", pattern: /^\/internal\/v1\/accounts\/customer-link$/, csrf: false, run: customerLink },
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

async function summary(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  return json(200, await deps.workflows.summary(session(request)));
}

async function accounts(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listAccounts(session(request), query);
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function account(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  return json(200, await deps.workflows.getAccount(session(request), params.id ?? ""));
}

async function movements(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  const query = page(deps, request);
  const directionValue = request.query.direction;
  if (directionValue !== undefined && directionValue !== "" && directionValue !== "in" && directionValue !== "out") {
    throw new AccountsError("VALIDATION_ERROR", "La dirección no está permitida", [{ field: "direction", code: "invalid" }]);
  }
  const found = await deps.workflows.listMovements(session(request), params.id ?? "", query, {
    direction: directionValue === "in" || directionValue === "out" ? directionValue : undefined,
    from: optionalInstant(request.query.from, "from"),
    to: optionalInstant(request.query.to, "to"),
  });
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function transfers(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  const query = page(deps, request);
  const found = await deps.workflows.listTransfers(session(request), query);
  return json(200, pageResult(found.items, found.totalItems, query));
}

async function transfer(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  return json(200, await deps.workflows.getTransfer(session(request), params.id ?? ""));
}

async function receipt(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  return json(200, await deps.workflows.receipt(session(request), params.id ?? ""));
}

async function beneficiaries(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  const search = typeof request.query.search === "string" ? request.query.search : "";
  if (search.length > 80) {
    throw new AccountsError("VALIDATION_ERROR", "La búsqueda es demasiado larga", [{ field: "search", code: "max" }]);
  }
  const limit = request.query.limit === undefined || request.query.limit === "" ? deps.cursorDefault : positive(request.query.limit, "limit");
  if (limit > deps.cursorMax) {
    throw new AccountsError("VALIDATION_ERROR", "El cursor supera el máximo", [{ field: "limit", code: "max" }]);
  }
  const cursor = typeof request.query.cursor === "string" && request.query.cursor !== "" ? request.query.cursor : undefined;
  return json(200, await deps.workflows.listBeneficiaries(session(request), search, cursor, limit));
}

async function createBeneficiary(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  const body = parse(z.object({ destinationAccountId: uuid, alias: z.string().trim().min(1).max(80) }).strict(), request.body);
  return json(201, await deps.workflows.createBeneficiary(session(request), body.destinationAccountId, body.alias, request.correlationId));
}

async function renameBeneficiary(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  const body = parse(z.object({ alias: z.string().trim().min(1).max(80) }).strict(), request.body);
  return json(200, await deps.workflows.renameBeneficiary(session(request), params.id ?? "", body.alias, request.correlationId));
}

async function deleteBeneficiary(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  await deps.workflows.deleteBeneficiary(session(request), params.id ?? "", request.correlationId);
  return empty(204);
}

async function resolveRecipient(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  const body = parse(z.object({ destinationAccountNumber: z.string().regex(/^[0-9]{10,18}$/) }).strict(), request.body);
  return json(200, await deps.workflows.resolveRecipient(session(request), body.destinationAccountNumber));
}

async function createProposal(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  const body = parse(z.object({
    sourceAccountId: uuid,
    beneficiaryId: uuid.optional(),
    destinationAccountNumber: z.string().regex(/^[0-9]{10,18}$/).optional(),
    amount: money,
    currency: z.literal("MXN"),
    concept: z.string().trim().min(1).max(140),
  }).strict(), request.body);
  return json(201, await deps.workflows.createProposal(session(request), body));
}

async function proposal(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  return json(200, await deps.workflows.getProposal(session(request), params.id ?? ""));
}

async function cancelProposal(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  await deps.workflows.cancelProposal(session(request), params.id ?? "");
  return empty(204);
}

async function confirmProposal(deps: AccountsHttpDependencies, request: AccountsHttpRequest, params: Record<string, string>): Promise<AccountsHttpResult> {
  parse(z.object({}).strict(), request.body ?? {});
  const key = request.idempotencyKey ?? "";
  if (key.length < 16 || key.length > 200) {
    throw new AccountsError("VALIDATION_ERROR", "La clave de idempotencia es obligatoria", [{ field: "Idempotency-Key", code: "invalid" }]);
  }
  return json(200, await deps.workflows.confirmProposal(session(request), params.id ?? "", key, request.correlationId));
}

async function limits(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  return json(200, await deps.workflows.getLimits(session(request)));
}

async function updateLimits(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  const body = parse(z.object({ perTransferLimit: money, dailyLimit: money }).strict(), request.body);
  return json(200, await deps.workflows.updateLimits(session(request), body.perTransferLimit, body.dailyLimit, request.correlationId));
}

async function eligibility(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  await assertEligibilityCaller(request.authorization, deps.eligibilitySecrets);
  const body = parse(z.object({
    customerId: uuid,
    fields: z.array(z.enum(["totalBalance", "accountAgeDays"])),
  }).strict(), request.body);
  return json(200, await deps.workflows.eligibility(body.customerId, body.fields));
}

async function customerLink(deps: AccountsHttpDependencies, request: AccountsHttpRequest): Promise<AccountsHttpResult> {
  await assertEligibilityCaller(request.authorization, deps.eligibilitySecrets);
  const body = parse(z.object({ userId: uuid }).strict(), request.body);
  return json(200, await deps.workflows.customerLink(body.userId));
}

function page(deps: AccountsHttpDependencies, request: AccountsHttpRequest) {
  return parsePageQuery({ ...request.query, pageDefault: deps.pageDefault, pageMax: deps.pageMax });
}

function session(request: AccountsHttpRequest): string {
  return readCookie(request.cookie, "portal_session") ?? "";
}

function assertCsrf(request: AccountsHttpRequest): void {
  const cookie = readCookie(request.cookie, "portal_csrf");
  if (!cookie || !request.csrf || cookie.length !== request.csrf.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(request.csrf))) {
    throw new AccountsError("CSRF_INVALID", "La verificación CSRF no es válida");
  }
}

function optionalInstant(value: unknown, field: string): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new AccountsError("VALIDATION_ERROR", "La fecha no es válida", [{ field, code: "invalid" }]);
  }
  return new Date(value).toISOString();
}

function positive(value: unknown, field: string): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    throw new AccountsError("VALIDATION_ERROR", "El límite no es válido", [{ field, code: "invalid" }]);
  }
  return Number(text);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new AccountsError("VALIDATION_ERROR", "La solicitud no es válida", parsed.error.issues.slice(0, 8).map((issue) => ({
      field: issue.path.join(".") || "body",
      code: "invalid",
    })));
  }
  return parsed.data;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function json(status: number, body: unknown): AccountsHttpResult {
  return { status, body, headers: {} };
}

function empty(status: number): AccountsHttpResult {
  return { status, headers: {} };
}
