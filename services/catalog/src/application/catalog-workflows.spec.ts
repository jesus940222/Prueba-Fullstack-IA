import { CatalogError } from "../domain/catalog-error";
import { publishPending } from "./outbox";
import type { AccountsContext, Authorizer } from "./ports";
import { CatalogWorkflows } from "./catalog-workflows";
import { MemoryCatalogStore } from "./testing/memory-store";

const now = new Date("2026-10-21T18:00:00.000Z");
const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const customerId = "00000000-0000-4000-8000-0000000000c1";
const correlationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const page = { page: 1, pageSize: 20, sort: "-createdAt" as const };
const inversion = { schemaVersion: 1, attributes: { termMonths: 12, minimumAmount: "1000.00", rateLabel: "ilustrativa" } };

function harness(accounts: Partial<AccountsContext> = {}, authorize?: Authorizer["authorize"]) {
  const store = new MemoryCatalogStore();
  let sequence = 16;
  const workflows = new CatalogWorkflows(
    store,
    { authorize: authorize ?? (async () => ({ userId, sessionId })) },
    {
      customerIdForUser: async () => customerId,
      eligibility: async () => ({ verifiable: true, totalBalance: "32850.00", accountAgeDays: 200 }),
      ...accounts,
    },
    { now: () => now },
    { uuid: () => `00000000-0000-4000-8000-${(sequence += 1).toString(16).padStart(12, "0")}` },
  );
  return { store, workflows };
}

async function catalog(workflows: CatalogWorkflows) {
  const category = await workflows.createCategory("token", { code: "inversion", name: "Inversión" });
  const product = await workflows.createProduct("token", {
    categoryId: category.id,
    code: "fondo-diario",
    name: "Fondo diario",
    currency: "MXN",
    status: "active",
    conditions: inversion,
  }, correlationId);
  const general = await workflows.createOffer("token", {
    productId: product.id,
    code: "bienvenida",
    title: "Bienvenida",
    audienceType: "general",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2027-01-01T00:00:00.000Z",
  }, correlationId);
  const expired = await workflows.createOffer("token", {
    productId: product.id,
    code: "vencida",
    title: "Vencida",
    audienceType: "general",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2026-03-01T00:00:00.000Z",
  }, correlationId);
  const ruled = await workflows.createOffer("token", {
    productId: product.id,
    code: "saldo-alto",
    title: "Saldo alto",
    audienceType: "rules",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2027-01-01T00:00:00.000Z",
  }, correlationId);
  await workflows.replaceRules("token", ruled.id, [{ field: "totalBalance", operator: "gte", value: "20000.00" }], correlationId);
  const direct = await workflows.createOffer("token", {
    productId: product.id,
    code: "dirigida",
    title: "Dirigida",
    audienceType: "direct",
    status: "active",
  }, correlationId);
  return { category, product, general, expired, ruled, direct };
}

describe("catalog workflows", () => {
  it("shows general, rules and direct offers and hides the expired one", async () => {
    const { workflows } = harness();
    const seeded = await catalog(workflows);
    await workflows.createAssignment("token", seeded.direct.id, customerId, "Campaña", correlationId);
    const offers = await workflows.listMyOffers("token", page);
    expect(offers.items.map((item) => item.code).sort()).toEqual(["bienvenida", "dirigida", "saldo-alto"]);
    expect(offers.items.every((item) => item.eligible)).toBe(true);
    expect(await workflows.getMyOffer("token", seeded.general.id)).toMatchObject({ code: "bienvenida" });
    await expect(workflows.getMyOffer("token", seeded.expired.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    expect((await workflows.listPublicProducts("token", page)).items).toEqual([expect.objectContaining({ code: "fondo-diario", termsVersion: 1 })]);
  });

  it("does not grant rules when Cuentas is unverifiable or unavailable", async () => {
    const denied = harness({ eligibility: async () => ({ verifiable: false }) });
    const seeded = await catalog(denied.workflows);
    const visible = await denied.workflows.listMyOffers("token", page);
    expect(visible.items.map((item) => item.code)).toEqual(["bienvenida"]);
    const down = harness({ eligibility: async () => { throw new CatalogError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar el contexto de Cuentas"); } });
    await catalog(down.workflows);
    await expect(down.workflows.listMyOffers("token", page)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    await expect(seeded.direct).toBeTruthy();
  });

  it("keeps offers disabled after the product is restored and rejects a deleted product", async () => {
    const { workflows, store } = harness();
    const seeded = await catalog(workflows);
    await workflows.deleteProduct("token", seeded.product.id, correlationId);
    expect((await workflows.listPublicProducts("token", page)).items).toEqual([]);
    await expect(workflows.getPublicProduct("token", seeded.product.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    const restored = await workflows.restoreProduct("token", seeded.product.id, correlationId);
    expect(restored.status).toBe("active");
    expect(store.offers.find((item) => item.id === seeded.general.id)?.status).toBe("disabled");
    expect((await workflows.listMyOffers("token", page)).items).toEqual([]);
    expect(store.outbox.some((event) => event.eventType === "product.changed" && event.payload.change === "restored")).toBe(true);
    const published = await publishPending(store, { publish: async () => undefined }, 20, now.toISOString());
    expect(published).toBeGreaterThan(0);
    expect(await publishPending(store, { publish: async () => undefined }, 20, now.toISOString())).toBe(0);
    store.outbox.push({ id: "00000000-0000-4000-8000-0000000000ee", eventType: "product.changed", aggregateId: seeded.product.id, actorId: "00000000-0000-4000-8000-000000000001", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", payload: { product_id: seeded.product.id, change: "updated" }, occurredAt: now.toISOString(), publishedAt: null });
    await expect(publishPending(store, { publish: async () => { throw new Error("down"); } }, 20, now.toISOString())).rejects.toThrow("down");
  });

  it("versions terms, refuses unknown attributes and blocks deleted reads", async () => {
    const { workflows } = harness();
    const seeded = await catalog(workflows);
    const updated = await workflows.updateProduct("token", seeded.product.id, {
      categoryId: seeded.category.id,
      code: "fondo-diario",
      name: "Fondo diario",
      currency: "MXN",
      termsText: "Términos nuevos",
      status: "active",
      conditions: inversion,
    }, correlationId);
    expect(updated.termsVersion).toBe(2);
    await expect(workflows.createProduct("token", {
      categoryId: seeded.category.id,
      code: "otro",
      name: "Otro",
      currency: "MXN",
      conditions: { schemaVersion: 1, attributes: { secreto: "no" } },
    }, correlationId)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const limited = harness({}, async (_token, permission) => {
      if (permission.endsWith(":deleted")) {
        throw new CatalogError("PERMISSION_DENIED", "No tienes permiso para esta operación");
      }
      return { userId, sessionId };
    });
    await expect(limited.workflows.listAdminProducts("token", page, true)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(workflows.createAssignment("token", seeded.general.id, customerId, "No aplica", correlationId)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(workflows.replaceRules("token", seeded.general.id, [], correlationId)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(workflows.createCategory("token", { code: "inversion", name: "Otra" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("returns an empty offer list when the user has no customer", async () => {
    const { workflows } = harness({ customerIdForUser: async () => null });
    await catalog(workflows);
    expect(await workflows.listMyOffers("token", page)).toEqual({ items: [], totalItems: 0 });
    await expect(workflows.getMyOffer("token", "00000000-0000-4000-8000-000000000099")).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
  });
});
