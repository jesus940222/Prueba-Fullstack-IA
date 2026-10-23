import type { NextFunction, Request, Response } from "express";
import { CatalogError } from "../../domain/catalog-error";
import { CatalogWorkflows } from "../../application/catalog-workflows";
import { MemoryCatalogStore } from "../../application/testing/memory-store";
import { handleCatalog, mountCatalog, type CatalogHttpDependencies, type CatalogHttpRequest } from "./catalog-handler";

const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const csrf = "csrf-token-catalog";
const correlationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(overrides: Partial<CatalogHttpRequest> = {}): CatalogHttpRequest {
  return {
    method: "GET",
    path: "/api/v1/catalog/categories",
    query: {},
    body: {},
    cookie: `portal_csrf=${csrf}; portal_session=session-token-value`,
    csrf,
    correlationId,
    ...overrides,
  };
}

function dependencies(authorize: (permission: string) => Promise<{ userId: string; sessionId: string }> = async () => ({ userId, sessionId })): CatalogHttpDependencies {
  let sequence = 32;
  return {
    workflows: new CatalogWorkflows(
      new MemoryCatalogStore(),
      { authorize: async (_token, permission) => authorize(permission) },
      { customerIdForUser: async () => null, eligibility: async () => ({ verifiable: false }) },
      { now: () => new Date("2026-10-21T18:00:00.000Z") },
      { uuid: () => `00000000-0000-4000-8000-${(sequence += 1).toString(16).padStart(12, "0")}` },
    ),
    pageDefault: 20,
    pageMax: 100,
  };
}

describe("catalog http", () => {
  it("rejects an unknown route, a bad csrf and a deleted flag without permission", async () => {
    const deps = dependencies(async (permission) => {
      if (permission.endsWith(":deleted")) {
        throw new CatalogError("PERMISSION_DENIED", "No tienes permiso para esta operación");
      }
      return { userId, sessionId };
    });
    expect((await handleCatalog(deps, request({ path: "/api/v1/catalog/missing" }))).status).toBe(404);
    expect((await handleCatalog(deps, request({ method: "POST", path: "/api/v1/catalog/admin/categories", csrf: "no" }))).status).toBe(403);
    expect((await handleCatalog(deps, request({ path: "/api/v1/catalog/admin/categories", query: { includeDeleted: "yes" } }))).status).toBe(422);
    expect((await handleCatalog(deps, request({ path: "/api/v1/catalog/admin/products", query: { includeDeleted: "true" } }))).status).toBe(403);
    expect((await handleCatalog(deps, request({ query: { sort: "name" } }))).status).toBe(422);
    const created = await handleCatalog(deps, request({
      method: "POST",
      path: "/api/v1/catalog/admin/categories",
      body: { code: "inversion", name: "Inversión" },
    }));
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect((await handleCatalog(deps, request({ path: `/api/v1/catalog/admin/categories/${id}` }))).status).toBe(200);
    expect((await handleCatalog(deps, request({ method: "DELETE", path: `/api/v1/catalog/admin/categories/${id}` }))).status).toBe(204);
    expect((await handleCatalog(deps, request({ method: "POST", path: `/api/v1/catalog/admin/categories/${id}/restore`, body: {} }))).status).toBe(200);
    const revoked = dependencies(async () => { throw new CatalogError("SESSION_INVALID", "La sesión no es válida"); });
    expect((await handleCatalog(revoked, request())).status).toBe(401);
    const broken = { ...deps, workflows: { listPublicCategories: async () => { throw new Error("boom"); } } as unknown as CatalogWorkflows };
    expect((await handleCatalog(broken, request())).status).toBe(500);
  });

  it("mounts the catalog response", async () => {
    const deps = dependencies();
    let captured: ((req: Request, res: Response, next: NextFunction) => void) | undefined;
    mountCatalog({ use(handler) { captured = handler; } }, deps);
    const json = jest.fn();
    const response = {
      getHeader: () => correlationId,
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn(() => ({ json, end: jest.fn() })),
    } as unknown as Response;
    captured?.({
      method: "GET",
      path: "/api/v1/catalog/categories",
      query: {},
      header: (name: string) => name === "cookie" ? `portal_csrf=${csrf}; portal_session=session-token-value` : undefined,
    } as unknown as Request, response, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalled();
    captured?.({ method: "GET", path: "/health", query: {}, header: () => undefined } as unknown as Request, response, jest.fn());
  });
});
