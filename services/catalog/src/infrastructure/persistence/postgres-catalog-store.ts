import type { EntityManager } from "typeorm";
import { DataSource } from "typeorm";
import { CatalogError } from "../../domain/catalog-error";
import { sortDirection, type PageQuery } from "../../domain/pagination";
import type {
  AssignmentRecord,
  CategoryRecord,
  CategoryStatus,
  OfferRecord,
  OutboxRecord,
  ProductRecord,
  PublishStatus,
  RuleRecord,
} from "../../domain/records";
import type { CatalogStore, Page, ProductScope } from "../../application/ports";

type Row = Record<string, unknown>;

export class PostgresCatalogStore implements CatalogStore {
  constructor(private readonly dataSource: DataSource) {}

  async listCategories(query: PageQuery, includeDeleted: boolean, activeOnly: boolean) {
    const where = ["TRUE"];
    if (!includeDeleted) {
      where.push("deleted_at IS NULL");
    }
    if (activeOnly) {
      where.push("status = 'active' AND deleted_at IS NULL");
    }
    return this.page(`categories`, where.join(" AND "), [], query, categoryOf);
  }

  async findCategory(id: string) {
    const rows = await this.dataSource.query<Row[]>(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = $1`, [id]);
    return rows[0] ? categoryOf(rows[0]) : null;
  }

  async saveCategory(category: CategoryRecord) {
    await unique(async () => {
      await this.dataSource.query(
        `INSERT INTO categories (id, code, name, description, status, deleted_at, deleted_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description,
           status = EXCLUDED.status, deleted_at = EXCLUDED.deleted_at, deleted_by = EXCLUDED.deleted_by, updated_at = EXCLUDED.updated_at`,
        [category.id, category.code, category.name, category.description, category.status, category.deletedAt, category.deletedBy, category.createdAt, category.updatedAt],
      );
    });
  }

  async listProducts(query: PageQuery, scope: ProductScope) {
    const where = ["TRUE"];
    const params: unknown[] = [];
    if (!scope.includeDeleted) {
      where.push("p.deleted_at IS NULL");
    }
    if (scope.categoryId) {
      params.push(scope.categoryId);
      where.push(`p.category_id = $${params.length}`);
    }
    if (scope.activeOnly) {
      where.push("p.status = 'active' AND p.deleted_at IS NULL AND c.status = 'active' AND c.deleted_at IS NULL");
    }
    const clause = where.join(" AND ");
    const order = sortDirection(query.sort);
    const total = await this.count(
      `SELECT count(*)::int AS total FROM products p JOIN categories c ON c.id = p.category_id WHERE ${clause}`,
      params,
    );
    const rows = await this.dataSource.query<Row[]>(
      `SELECT ${productColumns("p")} FROM products p JOIN categories c ON c.id = p.category_id WHERE ${clause}
       ORDER BY p.created_at ${order}, p.id ${order} OFFSET $${params.length + 1} LIMIT $${params.length + 2}`,
      [...params, (query.page - 1) * query.pageSize, query.pageSize],
    );
    const items = await this.withConditions(rows.map(productOf));
    return { items, totalItems: total };
  }

  async findProduct(id: string) {
    const rows = await this.dataSource.query<Row[]>(`SELECT ${productColumns("products")} FROM products WHERE id = $1`, [id]);
    const product = rows[0] ? productOf(rows[0]) : null;
    if (!product) {
      return null;
    }
    const [withConditions] = await this.withConditions([product]);
    return withConditions ?? null;
  }

  async saveProduct(product: ProductRecord, event: OutboxRecord) {
    await this.dataSource.transaction(async (manager) => {
      await unique(async () => {
        await manager.query(
          `INSERT INTO products (id, category_id, code, name, summary, description, currency, terms_version, terms_text, status, deleted_at, deleted_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'MXN',$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET category_id = EXCLUDED.category_id, code = EXCLUDED.code, name = EXCLUDED.name,
             summary = EXCLUDED.summary, description = EXCLUDED.description, terms_version = EXCLUDED.terms_version,
             terms_text = EXCLUDED.terms_text, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
          [product.id, product.categoryId, product.code, product.name, product.summary, product.description, product.termsVersion, product.termsText, product.status, product.deletedAt, product.deletedBy, product.createdAt, product.updatedAt],
        );
      });
      await manager.query(
        `INSERT INTO product_conditions (product_id, schema_version, attributes) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (product_id) DO UPDATE SET schema_version = EXCLUDED.schema_version, attributes = EXCLUDED.attributes`,
        [product.id, product.conditions.schemaVersion, JSON.stringify(product.conditions.attributes)],
      );
      await insertOutbox(manager, event);
    });
  }

  async deleteProduct(id: string, actorId: string, at: string, eventsFor: (disabledOfferIds: string[]) => OutboxRecord[]) {
    return this.dataSource.transaction(async (manager) => {
      const rows = returnedRows(await manager.query<Row[] | [Row[], number]>(
        `UPDATE products SET deleted_at = $2, deleted_by = $3, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING ${productColumns("products")}`,
        [id, at, actorId],
      ));
      const row = rows[0];
      if (!row) {
        return null;
      }
      const disabled = returnedRows(await manager.query<Row[] | [Row[], number]>(
        `UPDATE offers SET status = 'disabled', updated_at = $2 WHERE product_id = $1 AND status = 'active' AND deleted_at IS NULL RETURNING id`,
        [id, at],
      ));
      for (const event of eventsFor(disabled.map((item) => String(item.id)))) {
        await insertOutbox(manager, event);
      }
      const [product] = await this.withConditions([productOf(row)], manager);
      return product ?? null;
    });
  }

  async restoreProduct(id: string, at: string, event: OutboxRecord) {
    return this.dataSource.transaction(async (manager) => {
      const rows = returnedRows(await manager.query<Row[] | [Row[], number]>(
        `UPDATE products SET deleted_at = NULL, deleted_by = NULL, updated_at = $2 WHERE id = $1 AND deleted_at IS NOT NULL RETURNING ${productColumns("products")}`,
        [id, at],
      ));
      const row = rows[0];
      if (!row) {
        const existing = await manager.query<Row[]>(`SELECT id, deleted_at FROM products WHERE id = $1`, [id]);
        if (existing[0] && existing[0].deleted_at === null) {
          throw new CatalogError("CONFLICT", "El producto no está eliminado");
        }
        return null;
      }
      await insertOutbox(manager, event);
      const [product] = await this.withConditions([productOf(row)], manager);
      return product ?? null;
    });
  }

  async listOffers(query: PageQuery, includeDeleted: boolean) {
    const where = includeDeleted ? "TRUE" : "deleted_at IS NULL";
    return this.page("offers", where, [], query, offerOf);
  }

  async findOffer(id: string) {
    const rows = await this.dataSource.query<Row[]>(`SELECT ${OFFER_COLUMNS} FROM offers WHERE id = $1`, [id]);
    return rows[0] ? offerOf(rows[0]) : null;
  }

  async saveOffer(offer: OfferRecord, event: OutboxRecord) {
    await this.dataSource.transaction(async (manager) => {
      await unique(async () => {
        await manager.query(
          `INSERT INTO offers (id, product_id, code, title, description, benefit_type, benefit_value, starts_at, ends_at, priority, audience_type, status, deleted_at, deleted_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'information',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (id) DO UPDATE SET product_id = EXCLUDED.product_id, code = EXCLUDED.code, title = EXCLUDED.title,
             description = EXCLUDED.description, benefit_value = EXCLUDED.benefit_value, starts_at = EXCLUDED.starts_at,
             ends_at = EXCLUDED.ends_at, priority = EXCLUDED.priority, audience_type = EXCLUDED.audience_type,
             status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
          [offer.id, offer.productId, offer.code, offer.title, offer.description, offer.benefitValue, offer.startsAt, offer.endsAt, offer.priority, offer.audienceType, offer.status, offer.deletedAt, offer.deletedBy, offer.createdAt, offer.updatedAt],
        );
      });
      await insertOutbox(manager, event);
    });
  }

  async deleteOffer(id: string, actorId: string, at: string, event: OutboxRecord) {
    return this.dataSource.transaction(async (manager) => {
      const rows = returnedRows(await manager.query<Row[] | [Row[], number]>(
        `UPDATE offers SET deleted_at = $2, deleted_by = $3, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING ${OFFER_COLUMNS}`,
        [id, at, actorId],
      ));
      if (!rows[0]) {
        return null;
      }
      await insertOutbox(manager, event);
      return offerOf(rows[0]);
    });
  }

  async restoreOffer(id: string, at: string, event: OutboxRecord) {
    return this.dataSource.transaction(async (manager) => {
      const rows = returnedRows(await manager.query<Row[] | [Row[], number]>(
        `UPDATE offers SET deleted_at = NULL, deleted_by = NULL, status = 'disabled', updated_at = $2
         WHERE id = $1 AND deleted_at IS NOT NULL RETURNING ${OFFER_COLUMNS}`,
        [id, at],
      ));
      if (!rows[0]) {
        const existing = await manager.query<Row[]>(`SELECT deleted_at FROM offers WHERE id = $1`, [id]);
        if (existing[0] && existing[0].deleted_at === null) {
          throw new CatalogError("CONFLICT", "La oferta no está eliminada");
        }
        return null;
      }
      await insertOutbox(manager, event);
      return offerOf(rows[0]);
    });
  }

  async candidateOffers() {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT ${offerColumns("o")} FROM offers o
       JOIN products p ON p.id = o.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE o.deleted_at IS NULL AND o.status = 'active' AND p.deleted_at IS NULL AND p.status = 'active'
         AND c.deleted_at IS NULL AND c.status = 'active'`,
    );
    return rows.map(offerOf);
  }

  async rulesOf(offerIds: readonly string[]) {
    if (offerIds.length === 0) {
      return [];
    }
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, offer_id, field, operator, value FROM eligibility_rules WHERE offer_id = ANY($1::uuid[])`,
      [offerIds],
    );
    return rows.map(ruleOf);
  }

  async replaceRules(offerId: string, rules: RuleRecord[], event: OutboxRecord) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM eligibility_rules WHERE offer_id = $1`, [offerId]);
      for (const rule of rules) {
        await manager.query(
          `INSERT INTO eligibility_rules (id, offer_id, field, operator, value) VALUES ($1, $2, $3, $4, $5)`,
          [rule.id, rule.offerId, rule.field, rule.operator, rule.value],
        );
      }
      await insertOutbox(manager, event);
    });
  }

  async listAssignments(offerId: string, query: PageQuery) {
    return this.page("offer_assignments", "offer_id = $1 AND deleted_at IS NULL", [offerId], query, assignmentOf, "created_at");
  }

  async assignedOfferIds(customerId: string, offerIds: readonly string[]) {
    if (offerIds.length === 0) {
      return [];
    }
    const rows = await this.dataSource.query<Row[]>(
      `SELECT offer_id FROM offer_assignments WHERE customer_id = $1 AND deleted_at IS NULL AND offer_id = ANY($2::uuid[])`,
      [customerId, offerIds],
    );
    return rows.map((row) => String(row.offer_id));
  }

  async saveAssignment(assignment: AssignmentRecord, event: OutboxRecord) {
    await this.dataSource.transaction(async (manager) => {
      await unique(async () => {
        await manager.query(
          `INSERT INTO offer_assignments (id, offer_id, customer_id, assigned_by, reason, deleted_at, deleted_by, created_at)
           VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6)`,
          [assignment.id, assignment.offerId, assignment.customerId, assignment.assignedBy, assignment.reason, assignment.createdAt],
        );
      });
      await insertOutbox(manager, event);
    });
  }

  async deleteAssignment(offerId: string, assignmentId: string, actorId: string, at: string, event: OutboxRecord) {
    return this.dataSource.transaction(async (manager) => {
      const rows = returnedRows(await manager.query<Row[] | [Row[], number]>(
        `UPDATE offer_assignments SET deleted_at = $3, deleted_by = $4 WHERE id = $1 AND offer_id = $2 AND deleted_at IS NULL RETURNING id`,
        [assignmentId, offerId, at, actorId],
      ));
      if (!rows[0]) {
        return false;
      }
      await insertOutbox(manager, event);
      return true;
    });
  }

  async unpublishedOutbox(limit: number) {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, event_type, aggregate_id, actor_id, correlation_id, payload, occurred_at FROM outbox_events
       WHERE published_at IS NULL ORDER BY occurred_at LIMIT $1`,
      [limit],
    );
    return rows.map(outboxOf);
  }

  async markOutboxPublished(ids: readonly string[], at: string) {
    if (ids.length === 0) {
      return;
    }
    await this.dataSource.query(`UPDATE outbox_events SET published_at = $2 WHERE id = ANY($1::uuid[]) AND published_at IS NULL`, [ids, at]);
  }

  private async page<T>(table: string, where: string, params: unknown[], query: PageQuery, map: (row: Row) => T, created = "created_at"): Promise<Page<T>> {
    const order = sortDirection(query.sort);
    const total = await this.count(`SELECT count(*)::int AS total FROM ${table} WHERE ${where}`, params);
    const columns = table === "categories" ? CATEGORY_COLUMNS : table === "offers" ? OFFER_COLUMNS : ASSIGNMENT_COLUMNS;
    const rows = await this.dataSource.query<Row[]>(
      `SELECT ${columns} FROM ${table} WHERE ${where} ORDER BY ${created} ${order}, id ${order} OFFSET $${params.length + 1} LIMIT $${params.length + 2}`,
      [...params, (query.page - 1) * query.pageSize, query.pageSize],
    );
    return { items: rows.map(map), totalItems: total };
  }

  private async count(sql: string, params: unknown[]) {
    const rows = await this.dataSource.query<Row[]>(sql, params);
    return Number(rows[0]?.total ?? 0);
  }

  private async withConditions(products: ProductRecord[], manager: EntityManager | DataSource = this.dataSource) {
    if (products.length === 0) {
      return products;
    }
    const rows = await manager.query<Row[]>(
      `SELECT product_id, schema_version, attributes FROM product_conditions WHERE product_id = ANY($1::uuid[])`,
      [products.map((product) => product.id)],
    );
    const byId = new Map(rows.map((row) => [String(row.product_id), row]));
    return products.map((product) => {
      const row = byId.get(product.id);
      return {
        ...product,
        conditions: {
          schemaVersion: Number(row?.schema_version ?? 1),
          attributes: (row?.attributes ?? {}) as ProductRecord["conditions"]["attributes"],
        },
      };
    });
  }
}

const CATEGORY_COLUMNS = "id, code, name, description, status, deleted_at, deleted_by, created_at, updated_at";
const OFFER_COLUMNS = "id, product_id, code, title, description, benefit_type, benefit_value, starts_at, ends_at, priority, audience_type, status, deleted_at, deleted_by, created_at, updated_at";
const ASSIGNMENT_COLUMNS = "id, offer_id, customer_id, assigned_by, reason, deleted_at, deleted_by, created_at";

function productColumns(alias: string) {
  return `${alias}.id, ${alias}.category_id, ${alias}.code, ${alias}.name, ${alias}.summary, ${alias}.description, ${alias}.currency, ${alias}.terms_version, ${alias}.terms_text, ${alias}.status, ${alias}.deleted_at, ${alias}.deleted_by, ${alias}.created_at, ${alias}.updated_at`;
}

function offerColumns(alias: string) {
  return `${alias}.id, ${alias}.product_id, ${alias}.code, ${alias}.title, ${alias}.description, ${alias}.benefit_type, ${alias}.benefit_value, ${alias}.starts_at, ${alias}.ends_at, ${alias}.priority, ${alias}.audience_type, ${alias}.status, ${alias}.deleted_at, ${alias}.deleted_by, ${alias}.created_at, ${alias}.updated_at`;
}

function categoryOf(row: Row): CategoryRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    description: String(row.description ?? ""),
    status: row.status as CategoryStatus,
    deletedAt: instant(row.deleted_at),
    deletedBy: row.deleted_by ? String(row.deleted_by) : null,
    createdAt: instant(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: instant(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function productOf(row: Row): ProductRecord {
  return {
    id: String(row.id),
    categoryId: String(row.category_id),
    code: String(row.code),
    name: String(row.name),
    summary: String(row.summary ?? ""),
    description: String(row.description ?? ""),
    currency: "MXN",
    termsVersion: Number(row.terms_version),
    termsText: String(row.terms_text ?? ""),
    status: row.status as PublishStatus,
    conditions: { schemaVersion: 1, attributes: {} },
    deletedAt: instant(row.deleted_at),
    deletedBy: row.deleted_by ? String(row.deleted_by) : null,
    createdAt: instant(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: instant(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function offerOf(row: Row): OfferRecord {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    code: String(row.code),
    title: String(row.title),
    description: String(row.description ?? ""),
    benefitType: "information",
    benefitValue: String(row.benefit_value ?? ""),
    startsAt: instant(row.starts_at),
    endsAt: instant(row.ends_at),
    priority: Number(row.priority),
    audienceType: row.audience_type as OfferRecord["audienceType"],
    status: row.status as PublishStatus,
    deletedAt: instant(row.deleted_at),
    deletedBy: row.deleted_by ? String(row.deleted_by) : null,
    createdAt: instant(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: instant(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function ruleOf(row: Row): RuleRecord {
  return {
    id: String(row.id),
    offerId: String(row.offer_id),
    field: row.field as RuleRecord["field"],
    operator: row.operator as RuleRecord["operator"],
    value: String(row.value),
  };
}

function assignmentOf(row: Row): AssignmentRecord {
  return {
    id: String(row.id),
    offerId: String(row.offer_id),
    customerId: String(row.customer_id),
    assignedBy: String(row.assigned_by),
    reason: String(row.reason),
    deletedAt: instant(row.deleted_at),
    deletedBy: row.deleted_by ? String(row.deleted_by) : null,
    createdAt: instant(row.created_at) ?? new Date(0).toISOString(),
  };
}

function outboxOf(row: Row): OutboxRecord {
  const payload = row.payload as OutboxRecord["payload"];
  return {
    id: String(row.id),
    eventType: row.event_type as OutboxRecord["eventType"],
    aggregateId: String(row.aggregate_id),
    actorId: String(row.actor_id),
    correlationId: String(row.correlation_id),
    payload,
    occurredAt: instant(row.occurred_at) ?? new Date(0).toISOString(),
    publishedAt: null,
  };
}

function instant(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function returnedRows(result: unknown): Row[] {
  if (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === "number") {
    return result[0] as Row[];
  }
  return Array.isArray(result) ? result as Row[] : [];
}

async function insertOutbox(manager: EntityManager, event: OutboxRecord) {
  await manager.query(
    `INSERT INTO outbox_events (id, event_type, aggregate_id, actor_id, correlation_id, payload, occurred_at, published_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NULL)`,
    [event.id, event.eventType, event.aggregateId, event.actorId, event.correlationId, JSON.stringify(event.payload), event.occurredAt],
  );
}

async function unique(work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    const record = error as { code?: string; driverError?: { code?: string } };
    if (record.code === "23505" || record.driverError?.code === "23505") {
      throw new CatalogError("CONFLICT", "El código ya existe");
    }
    throw error;
  }
}
