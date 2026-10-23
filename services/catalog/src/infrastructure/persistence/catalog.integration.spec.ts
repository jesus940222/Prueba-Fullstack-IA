import { randomUUID } from "node:crypto";
import { CatalogError } from "../../domain/catalog-error";
import { CatalogWorkflows } from "../../application/catalog-workflows";
import { publishPending } from "../../application/outbox";
import type { AccountsContext, Authorizer } from "../../application/ports";
import { createDataSource } from "./data-source";
import { PostgresCatalogStore } from "./postgres-catalog-store";

const gateUrl = process.env.CATALOG_GATE_DATABASE_URL ?? "";
const gate = gateUrl === "" ? describe.skip : describe;
const userId = "00000000-0000-4000-8000-000000000201";
const sessionId = "00000000-0000-4000-8000-000000000202";
const customerId = "00000000-0000-4000-8000-000000000203";
const now = new Date("2026-10-21T18:00:00.000Z");
const page = { page: 1, pageSize: 20, sort: "-createdAt" as const };
const conditions = { schemaVersion: 1, attributes: { termMonths: 12, minimumAmount: "1000.00", rateLabel: "3.5%" } };

gate("catalog eligibility and logical delete", () => {
  const source = createDataSource(gateUrl);

  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    await source.query("TRUNCATE offer_assignments, eligibility_rules, offers, product_conditions, products, categories, outbox_events CASCADE");
  });

  afterAll(async () => {
    if (source.isInitialized) {
      await source.destroy();
    }
  });

  function workflows(accounts: AccountsContext, authorizer?: Authorizer) {
    return new CatalogWorkflows(
      new PostgresCatalogStore(source),
      authorizer ?? { async authorize() { return { userId, sessionId }; } },
      accounts,
      { now: () => now },
      { uuid: () => randomUUID() },
    );
  }

  function accounts(verifiable: boolean, fail = false): AccountsContext {
    return {
      async customerIdForUser() {
        return customerId;
      },
      async eligibility() {
        if (fail) {
          throw new CatalogError("DEPENDENCY_UNAVAILABLE", "Cuentas no está disponible");
        }
        return verifiable
          ? { verifiable: true, totalBalance: "32850.00", accountAgeDays: 200 }
          : { verifiable: false };
      },
    };
  }

  it("keeps general, rules and direct offers, hides an expired one, and fails closed when accounts is down", async () => {
    const app = workflows(accounts(true));
    const category = await app.createCategory("token", { code: "inversion", name: "Inversión", status: "active" });
    const product = await app.createProduct("token", {
      categoryId: category.id,
      code: "fondo-diario",
      name: "Fondo diario",
      currency: "MXN",
      status: "active",
      conditions,
    }, "00000000-0000-4000-8000-000000000210");
    await app.createOffer("token", {
      productId: product.id, code: "bienvenida", title: "Bienvenida", audienceType: "general", status: "active",
    }, "00000000-0000-4000-8000-000000000211");
    const ruled = await app.createOffer("token", {
      productId: product.id, code: "saldo", title: "Saldo", audienceType: "rules", status: "active",
    }, "00000000-0000-4000-8000-000000000212");
    await app.replaceRules("token", ruled.id, [{ field: "totalBalance", operator: "gte", value: "20000.00" }], "00000000-0000-4000-8000-000000000213");
    const direct = await app.createOffer("token", {
      productId: product.id, code: "seguro", title: "Seguro", audienceType: "direct", status: "active",
    }, "00000000-0000-4000-8000-000000000214");
    await app.createAssignment("token", direct.id, customerId, "asignación de prueba", "00000000-0000-4000-8000-000000000215");
    const expired = await app.createOffer("token", {
      productId: product.id, code: "vencida", title: "Vencida", audienceType: "general", status: "active", endsAt: "2026-03-01T00:00:00.000Z",
    }, "00000000-0000-4000-8000-000000000216");
    const visible = await app.listMyOffers("token", page);
    const titles = visible.items.map((item) => item.title);
    expect(titles).toEqual(expect.arrayContaining(["Bienvenida", "Saldo", "Seguro"]));
    expect(titles).not.toContain(expired.title);
    const denied = workflows(accounts(true), { async authorize() { throw new CatalogError("PERMISSION_DENIED", "sin permiso"); } });
    await expect(denied.listPublicProducts("token", page)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const unverified = workflows(accounts(false));
    const closed = await unverified.listMyOffers("token", page);
    expect(closed.items.map((item) => item.title)).toEqual(expect.arrayContaining(["Bienvenida", "Seguro"]));
    expect(closed.items.map((item) => item.title)).not.toContain("Saldo");
    const down = workflows(accounts(true, true));
    await expect(down.listMyOffers("token", page)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("hides a deleted product and does not reactivate its offers on restore", async () => {
    const app = workflows(accounts(true));
    const products = await app.listPublicProducts("token", page);
    const product = products.items[0];
    expect(product?.name).toBe("Fondo diario");
    if (!product) {
      throw new Error("product");
    }
    await app.deleteProduct("token", product.id, "00000000-0000-4000-8000-000000000217");
    expect((await app.listPublicProducts("token", page)).items).toHaveLength(0);
    await expect(app.getPublicProduct("token", product.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    const restored = await app.restoreProduct("token", product.id, "00000000-0000-4000-8000-000000000218");
    expect(restored.name).toBe("Fondo diario");
    expect((await app.listMyOffers("token", page)).items).toHaveLength(0);
    const store = new PostgresCatalogStore(source);
    const pending = await store.unpublishedOutbox(20);
    expect(pending.length).toBeGreaterThan(0);
    await expect(publishPending(store, { async publish() { throw new Error("broker_down"); } }, 20, now.toISOString())).rejects.toThrow("broker_down");
    expect((await store.unpublishedOutbox(20)).length).toBe(pending.length);
    expect(await publishPending(store, { async publish() { return undefined; } }, 50, now.toISOString())).toBeGreaterThan(0);
    expect(await store.unpublishedOutbox(20)).toHaveLength(0);
  });
});
