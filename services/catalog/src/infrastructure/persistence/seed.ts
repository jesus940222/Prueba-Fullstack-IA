import { createHash } from "node:crypto";
import type { DataSource } from "typeorm";

const OPENED = "2026-01-15T16:00:00.000Z";
const START = "2026-01-01T06:00:00.000Z";
const OPEN_END = "2027-01-01T06:00:00.000Z";
const EXPIRED_END = "2026-03-01T06:00:00.000Z";

const inversion = { schemaVersion: 1, attributes: { termMonths: 12, minimumAmount: "1000.00", rateLabel: "ilustrativa" } };
const prestamo = { schemaVersion: 1, attributes: { termMonths: 24, illustrativeRate: "ilustrativa", requiresReview: true } };
const seguro = { schemaVersion: 1, attributes: { termMonths: 12, coverageLabel: "hogar ilustrativo" } };

export async function seedCatalog(dataSource: DataSource): Promise<void> {
  const categories = [
    ["inversion", "Inversión", "Productos ilustrativos de inversión. No son una aprobación."],
    ["prestamo", "Préstamo", "Condiciones ficticias. No equivalen a un crédito otorgado."],
    ["seguro", "Seguro", "Coberturas de demostración."],
  ] as const;
  for (const [code, name, description] of categories) {
    await dataSource.query(
      `INSERT INTO categories (id, code, name, description, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $5) ON CONFLICT (code) DO NOTHING`,
      [stableId(`category:${code}`), code, name, description, OPENED],
    );
  }
  const products = [
    ["fondo-diario", "inversion", "Fondo diario", "Saldo ilustrativo", "active", inversion, null],
    ["prestamo-ilustrativo", "prestamo", "Préstamo ilustrativo", "Requiere revisión humana", "active", prestamo, null],
    ["seguro-hogar", "seguro", "Seguro hogar", "Cobertura de demostración", "active", seguro, null],
    ["borrador-interno", "inversion", "Borrador interno", "No se publica", "draft", inversion, null],
    ["producto-retirado", "inversion", "Producto retirado", "Eliminado de forma lógica", "disabled", inversion, OPENED],
  ] as const;
  for (const [code, category, name, summary, status, conditions, deletedAt] of products) {
    const id = stableId(`product:${code}`);
    await dataSource.query(
      `INSERT INTO products (id, category_id, code, name, summary, description, currency, terms_version, terms_text, status, deleted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'MXN', 1, $7, $8, $9, $10, $10) ON CONFLICT (code) DO NOTHING`,
      [id, stableId(`category:${category}`), code, name, summary, "Texto informativo de demostración. No constituye una oferta vinculante.", "Términos ilustrativos, versión 1.", status, deletedAt, OPENED],
    );
    await dataSource.query(
      `INSERT INTO product_conditions (product_id, schema_version, attributes)
       SELECT $1, $2, $3::jsonb WHERE NOT EXISTS (SELECT 1 FROM product_conditions WHERE product_id = $1)`,
      [id, conditions.schemaVersion, JSON.stringify(conditions.attributes)],
    );
  }
  const offers = [
    ["bienvenida-general", "fondo-diario", "Bienvenida general", "general", "active", START, OPEN_END, null],
    ["saldo-alto", "prestamo-ilustrativo", "Saldo ilustrativo", "rules", "active", START, OPEN_END, null],
    ["seguro-ana", "seguro-hogar", "Seguro dirigido", "direct", "active", START, OPEN_END, null],
    ["campana-vencida", "fondo-diario", "Campaña vencida", "general", "active", START, EXPIRED_END, null],
    ["oferta-borrador", "fondo-diario", "Oferta borrador", "general", "draft", START, OPEN_END, null],
    ["oferta-retirada", "producto-retirado", "Oferta retirada", "general", "disabled", START, OPEN_END, null],
  ] as const;
  for (const [code, product, title, audience, status, starts, ends, deletedAt] of offers) {
    await dataSource.query(
      `INSERT INTO offers (id, product_id, code, title, description, benefit_type, benefit_value, starts_at, ends_at, priority, audience_type, status, deleted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'information', $6, $7, $8, 10, $9, $10, $11, $12, $12) ON CONFLICT (code) DO NOTHING`,
      [stableId(`offer:${code}`), stableId(`product:${product}`), code, title, "Beneficio informativo. No contrata ni registra interés.", "información", starts, ends, audience, status, deletedAt, OPENED],
    );
  }
  await dataSource.query(
    `INSERT INTO eligibility_rules (id, offer_id, field, operator, value)
     SELECT $1, $2, 'totalBalance', 'gte', '20000.00'
     WHERE NOT EXISTS (SELECT 1 FROM eligibility_rules WHERE id = $1)`,
    [stableId("rule:saldo-alto"), stableId("offer:saldo-alto")],
  );
  await dataSource.query(
    `INSERT INTO offer_assignments (id, offer_id, customer_id, assigned_by, reason, created_at)
     SELECT $1, $2, $3, $4, $5, $6
     WHERE NOT EXISTS (SELECT 1 FROM offer_assignments WHERE offer_id = $2 AND customer_id = $3 AND deleted_at IS NULL)`,
    [stableId("assignment:seguro-ana"), stableId("offer:seguro-ana"), stableId("customer:C-1001"), stableId("user:elena.gestor@portal.local"), "Asignación de demostración", OPENED],
  );
}

export function stableId(name: string): string {
  const hex = createHash("sha256").update(`portal:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
