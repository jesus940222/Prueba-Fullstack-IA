import type { NextFunction, Request, Response } from "express";
import { AuditError } from "../../domain/audit-error";
import { AuditWorkflows } from "../../application/audit-workflows";
import { MemoryAuditStore } from "../../application/testing/memory-store";
import { handleAudit, mountAudit, type AuditHttpDependencies, type AuditHttpRequest } from "./audit-handler";

const userId = "22222222-2222-4222-8222-222222222222";
const correlationId = "33333333-3333-4333-8333-333333333333";

function request(overrides: Partial<AuditHttpRequest> = {}): AuditHttpRequest {
  return {
    method: "GET",
    path: "/api/v1/audit/events",
    query: {},
    cookie: "portal_session=session-token-value",
    correlationId,
    ...overrides,
  };
}

function dependencies(permission = "audit:read:any"): AuditHttpDependencies {
  let sequence = 80;
  return {
    workflows: new AuditWorkflows(
      new MemoryAuditStore(),
      { authorize: async (_token, requested) => {
        if (requested !== permission) {
          throw new AuditError("PERMISSION_DENIED", "No tienes permiso para esta operación");
        }
        return { userId, sessionId: "66666666-6666-4666-8666-666666666666" };
      } },
      { now: () => new Date("2026-10-21T18:00:00.000Z") },
      { uuid: () => `77777777-7777-4777-8777-${(sequence += 1).toString(16).padStart(12, "0")}` },
      31,
    ),
    pageDefault: 20,
    pageMax: 100,
  };
}

describe("audit http", () => {
  it("is read only and rejects a bad filter or a missing permission", async () => {
    const deps = dependencies();
    expect((await handleAudit(deps, request({ method: "DELETE" }))).status).toBe(404);
    expect((await handleAudit(deps, request({ path: "/api/v1/audit/missing" }))).status).toBe(404);
    expect((await handleAudit(deps, request({ query: { outcome: "maybe" } }))).status).toBe(422);
    expect((await handleAudit(deps, request())).status).toBe(200);
    expect((await handleAudit(dependencies("audit:read:own"), request({ path: "/api/v1/audit/me/events" }))).status).toBe(200);
    expect((await handleAudit(deps, request({ path: "/api/v1/audit/me/events" }))).status).toBe(403);
    expect((await handleAudit(deps, request({ path: `/api/v1/audit/correlations/${correlationId}/events` }))).status).toBe(200);
    expect((await handleAudit(deps, request({ path: "/api/v1/audit/events/00000000-0000-4000-8000-000000000099" }))).status).toBe(404);
    const broken = { ...deps, workflows: { list: async () => { throw new Error("boom"); } } as unknown as AuditWorkflows };
    expect((await handleAudit(broken, request())).status).toBe(500);
  });

  it("mounts only audit routes", async () => {
    let captured: ((req: Request, res: Response, next: NextFunction) => void) | undefined;
    mountAudit({ use(handler) { captured = handler; } }, dependencies());
    const json = jest.fn();
    const response = {
      getHeader: () => correlationId,
      headersSent: false,
      status: jest.fn(() => ({ json, end: jest.fn() })),
    } as unknown as Response;
    const next = jest.fn();
    captured?.({ method: "GET", path: "/health", query: {}, header: () => undefined } as unknown as Request, response, next);
    expect(next).toHaveBeenCalled();
    captured?.({
      method: "GET",
      path: "/api/v1/audit/events",
      query: {},
      header: (name: string) => name === "cookie" ? "portal_session=session-token-value" : undefined,
    } as unknown as Request, response, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(json).toHaveBeenCalled();
  });
});
