import { CatalogError } from "../../domain/catalog-error";
import type { PageQuery } from "../../domain/pagination";
import type { AssignmentRecord, CategoryRecord, OfferRecord, OutboxRecord, ProductRecord, RuleRecord } from "../../domain/records";
import type { CatalogStore, Page, ProductScope } from "../ports";

export class MemoryCatalogStore implements CatalogStore {
  categories: CategoryRecord[] = [];
  products: ProductRecord[] = [];
  offers: OfferRecord[] = [];
  rules: RuleRecord[] = [];
  assignments: AssignmentRecord[] = [];
  outbox: OutboxRecord[] = [];

  async listCategories(query: PageQuery, includeDeleted: boolean, activeOnly: boolean): Promise<Page<CategoryRecord>> {
    return page(this.categories.filter((item) => (includeDeleted || !item.deletedAt) && (!activeOnly || (item.status === "active" && !item.deletedAt))), query);
  }

  async findCategory(id: string) {
    return this.categories.find((item) => item.id === id) ?? null;
  }

  async saveCategory(category: CategoryRecord) {
    this.assertCode(this.categories, category.id, category.code);
    this.upsert(this.categories, category);
  }

  async listProducts(query: PageQuery, scope: ProductScope): Promise<Page<ProductRecord>> {
    const items = this.products.filter((item) => {
      if (!scope.includeDeleted && item.deletedAt) {
        return false;
      }
      if (scope.categoryId && item.categoryId !== scope.categoryId) {
        return false;
      }
      if (!scope.activeOnly) {
        return true;
      }
      const category = this.categories.find((entry) => entry.id === item.categoryId);
      return item.status === "active" && !item.deletedAt && category?.status === "active" && !category.deletedAt;
    });
    return page(items, query);
  }

  async findProduct(id: string) {
    return this.products.find((item) => item.id === id) ?? null;
  }

  async saveProduct(product: ProductRecord, event: OutboxRecord) {
    this.assertCode(this.products, product.id, product.code);
    this.upsert(this.products, product);
    this.outbox.push(event);
  }

  async deleteProduct(id: string, actorId: string, at: string, eventsFor: (disabledOfferIds: string[]) => OutboxRecord[]) {
    const product = this.products.find((item) => item.id === id && !item.deletedAt);
    if (!product) {
      return null;
    }
    const disabled = this.offers.filter((offer) => offer.productId === id && !offer.deletedAt && offer.status === "active").map((offer) => offer.id);
    for (const offer of this.offers) {
      if (disabled.includes(offer.id)) {
        offer.status = "disabled";
        offer.updatedAt = at;
      }
    }
    product.deletedAt = at;
    product.deletedBy = actorId;
    product.updatedAt = at;
    this.outbox.push(...eventsFor(disabled));
    return product;
  }

  async restoreProduct(id: string, at: string, event: OutboxRecord) {
    const product = this.products.find((item) => item.id === id);
    if (!product || !product.deletedAt) {
      if (product && !product.deletedAt) {
        throw new CatalogError("CONFLICT", "El producto no está eliminado");
      }
      return null;
    }
    product.deletedAt = null;
    product.deletedBy = null;
    product.updatedAt = at;
    this.outbox.push(event);
    return product;
  }

  async listOffers(query: PageQuery, includeDeleted: boolean) {
    return page(this.offers.filter((item) => includeDeleted || !item.deletedAt), query);
  }

  async findOffer(id: string) {
    return this.offers.find((item) => item.id === id) ?? null;
  }

  async saveOffer(offer: OfferRecord, event: OutboxRecord) {
    this.assertCode(this.offers, offer.id, offer.code);
    this.upsert(this.offers, offer);
    this.outbox.push(event);
  }

  async deleteOffer(id: string, actorId: string, at: string, event: OutboxRecord) {
    const offer = this.offers.find((item) => item.id === id && !item.deletedAt);
    if (!offer) {
      return null;
    }
    offer.deletedAt = at;
    offer.deletedBy = actorId;
    offer.updatedAt = at;
    this.outbox.push(event);
    return offer;
  }

  async restoreOffer(id: string, at: string, event: OutboxRecord) {
    const offer = this.offers.find((item) => item.id === id);
    if (!offer || !offer.deletedAt) {
      if (offer && !offer.deletedAt) {
        throw new CatalogError("CONFLICT", "La oferta no está eliminada");
      }
      return null;
    }
    offer.deletedAt = null;
    offer.deletedBy = null;
    offer.status = "disabled";
    offer.updatedAt = at;
    this.outbox.push(event);
    return offer;
  }

  async candidateOffers() {
    return this.offers.filter((offer) => {
      const product = this.products.find((item) => item.id === offer.productId);
      const category = product ? this.categories.find((item) => item.id === product.categoryId) : undefined;
      return !offer.deletedAt && offer.status === "active" && product?.status === "active" && !product.deletedAt && category?.status === "active" && !category.deletedAt;
    });
  }

  async rulesOf(offerIds: readonly string[]) {
    return this.rules.filter((rule) => offerIds.includes(rule.offerId));
  }

  async replaceRules(offerId: string, rules: RuleRecord[], event: OutboxRecord) {
    this.rules = this.rules.filter((rule) => rule.offerId !== offerId).concat(rules);
    this.outbox.push(event);
  }

  async listAssignments(offerId: string, query: PageQuery) {
    return page(this.assignments.filter((item) => item.offerId === offerId && !item.deletedAt), query);
  }

  async assignedOfferIds(customerId: string, offerIds: readonly string[]) {
    return this.assignments.filter((item) => item.customerId === customerId && !item.deletedAt && offerIds.includes(item.offerId)).map((item) => item.offerId);
  }

  async saveAssignment(assignment: AssignmentRecord, event: OutboxRecord) {
    const existing = this.assignments.find((item) => item.offerId === assignment.offerId && item.customerId === assignment.customerId && !item.deletedAt);
    if (existing) {
      throw new CatalogError("CONFLICT", "La asignación ya existe");
    }
    this.assignments.push(assignment);
    this.outbox.push(event);
  }

  async deleteAssignment(offerId: string, assignmentId: string, actorId: string, at: string, event: OutboxRecord) {
    const assignment = this.assignments.find((item) => item.id === assignmentId && item.offerId === offerId && !item.deletedAt);
    if (!assignment) {
      return false;
    }
    assignment.deletedAt = at;
    assignment.deletedBy = actorId;
    this.outbox.push(event);
    return true;
  }

  async unpublishedOutbox(limit: number) {
    return this.outbox.filter((event) => event.publishedAt === null).slice(0, limit);
  }

  async markOutboxPublished(ids: readonly string[], at: string) {
    for (const event of this.outbox) {
      if (ids.includes(event.id)) {
        event.publishedAt = at;
      }
    }
  }

  private assertCode(rows: Array<{ id: string; code: string }>, id: string, code: string) {
    if (rows.some((row) => row.code === code && row.id !== id)) {
      throw new CatalogError("CONFLICT", "El código ya existe");
    }
  }

  private upsert<T extends { id: string }>(rows: T[], value: T) {
    const index = rows.findIndex((row) => row.id === value.id);
    if (index >= 0) {
      rows[index] = value;
      return;
    }
    rows.push(value);
  }
}

function page<T extends { createdAt: string; id: string }>(items: T[], query: PageQuery): Page<T> {
  const factor = query.sort === "createdAt" ? 1 : -1;
  const sorted = [...items].sort((left, right) => (left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)) * factor);
  const start = (query.page - 1) * query.pageSize;
  return { items: sorted.slice(start, start + query.pageSize), totalItems: sorted.length };
}
