import { CatalogError } from "../domain/catalog-error";
import { assertConditions } from "../domain/conditions";
import { decideOffer, type FinancialContext } from "../domain/eligibility";
import type { PageQuery } from "../domain/pagination";
import type {
  AssignmentRecord,
  CategoryRecord,
  CategoryStatus,
  ConditionsRecord,
  OfferChange,
  OfferRecord,
  OutboxRecord,
  ProductChange,
  ProductRecord,
  PublishStatus,
  RuleRecord,
} from "../domain/records";
import type { AccountsContext, Authorizer, CatalogStore, Clock, Ids, Principal } from "./ports";

const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RULE_FIELDS = ["totalBalance", "accountAgeDays"] as const;
const OPERATORS = ["eq", "gte", "lte"] as const;

export interface CategoryWrite {
  code: string;
  name: string;
  description?: string;
  status?: CategoryStatus;
}

export interface ProductWrite {
  categoryId: string;
  code: string;
  name: string;
  summary?: string;
  description?: string;
  currency: "MXN";
  termsText?: string;
  status?: PublishStatus;
  conditions?: ConditionsRecord;
}

export interface OfferWrite {
  productId: string;
  code: string;
  title: string;
  description?: string;
  benefitType?: "information";
  benefitValue?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  audienceType: OfferRecord["audienceType"];
  status?: PublishStatus;
}

export interface RuleWrite {
  field: RuleRecord["field"];
  operator: RuleRecord["operator"];
  value: string;
}

export class CatalogWorkflows {
  constructor(
    private readonly store: CatalogStore,
    private readonly authorizer: Authorizer,
    private readonly accounts: AccountsContext,
    private readonly clock: Clock,
    private readonly ids: Ids,
  ) {}

  async listPublicCategories(sessionToken: string, query: PageQuery) {
    await this.principal(sessionToken, "products:read");
    const page = await this.store.listCategories(query, false, true);
    return { ...page, items: page.items.map(categoryView) };
  }

  async listPublicProducts(sessionToken: string, query: PageQuery, categoryId?: string) {
    await this.principal(sessionToken, "products:read");
    const page = await this.store.listProducts(query, { includeDeleted: false, activeOnly: true, categoryId });
    return { ...page, items: page.items.map(publicProduct) };
  }

  async getPublicProduct(sessionToken: string, id: string) {
    await this.principal(sessionToken, "products:read");
    const product = await this.visibleProduct(id);
    return publicProduct(product);
  }

  async listMyOffers(sessionToken: string, query: PageQuery) {
    const principal = await this.principal(sessionToken, "offers:read:own");
    const customerId = await this.accounts.customerIdForUser(principal.userId);
    if (!customerId) {
      return { items: [], totalItems: 0 };
    }
    return this.visibleOffers(customerId, query);
  }

  async getMyOffer(sessionToken: string, id: string) {
    const principal = await this.principal(sessionToken, "offers:read:own");
    const customerId = await this.accounts.customerIdForUser(principal.userId);
    if (!customerId) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La oferta no está disponible");
    }
    return this.oneVisibleOffer(customerId, id);
  }

  async listCustomerOffers(sessionToken: string, customerId: string, query: PageQuery) {
    await this.principal(sessionToken, "offers:read:any");
    return this.visibleOffers(customerId, query);
  }

  async listAdminCategories(sessionToken: string, query: PageQuery, includeDeleted: boolean) {
    await this.readAdmin(sessionToken, "categories:read", "categories:read:deleted", includeDeleted);
    const page = await this.store.listCategories(query, includeDeleted, false);
    return { ...page, items: page.items.map(categoryView) };
  }

  async getAdminCategory(sessionToken: string, id: string) {
    await this.principal(sessionToken, "categories:read");
    const category = await this.store.findCategory(id);
    if (!category || category.deletedAt) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La categoría no está disponible");
    }
    return categoryView(category);
  }

  async createCategory(sessionToken: string, input: CategoryWrite) {
    await this.principal(sessionToken, "categories:create");
    const category = this.newCategory(input);
    await this.store.saveCategory(category);
    return categoryView(category);
  }

  async updateCategory(sessionToken: string, id: string, input: CategoryWrite) {
    await this.principal(sessionToken, "categories:update");
    const current = await this.liveCategory(id);
    const next = { ...current, ...this.categoryFields(input), updatedAt: this.clock.now().toISOString() };
    await this.store.saveCategory(next);
    return categoryView(next);
  }

  async deleteCategory(sessionToken: string, id: string) {
    const principal = await this.principal(sessionToken, "categories:delete");
    const current = await this.liveCategory(id);
    const products = await this.store.listProducts({ page: 1, pageSize: 1, sort: "-createdAt" }, { includeDeleted: false, activeOnly: false, categoryId: id });
    if (products.totalItems > 0) {
      throw new CatalogError("CONFLICT", "La categoría todavía tiene productos");
    }
    const at = this.clock.now().toISOString();
    await this.store.saveCategory({ ...current, deletedAt: at, deletedBy: principal.userId, updatedAt: at });
  }

  async restoreCategory(sessionToken: string, id: string) {
    await this.principal(sessionToken, "categories:restore");
    const current = await this.store.findCategory(id);
    if (!current) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La categoría no está disponible");
    }
    if (!current.deletedAt) {
      throw new CatalogError("CONFLICT", "La categoría no está eliminada");
    }
    const at = this.clock.now().toISOString();
    const next = { ...current, deletedAt: null, deletedBy: null, updatedAt: at };
    await this.store.saveCategory(next);
    return categoryView(next);
  }

  async listAdminProducts(sessionToken: string, query: PageQuery, includeDeleted: boolean) {
    await this.readAdmin(sessionToken, "products:manage:read", "products:read:deleted", includeDeleted);
    const page = await this.store.listProducts(query, { includeDeleted, activeOnly: false });
    return { ...page, items: page.items.map(adminProduct) };
  }

  async getAdminProduct(sessionToken: string, id: string) {
    await this.principal(sessionToken, "products:manage:read");
    const product = await this.store.findProduct(id);
    if (!product || product.deletedAt) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "El producto no está disponible");
    }
    return adminProduct(product);
  }

  async createProduct(sessionToken: string, input: ProductWrite, correlationId: string) {
    const principal = await this.principal(sessionToken, "products:create");
    const category = await this.liveCategory(input.categoryId);
    const conditions = assertConditions(category.code, input.conditions ?? { schemaVersion: 1, attributes: {} });
    const at = this.clock.now().toISOString();
    const product: ProductRecord = {
      id: this.ids.uuid(),
      categoryId: category.id,
      code: assertCode(input.code),
      name: assertName(input.name),
      summary: input.summary ?? "",
      description: input.description ?? "",
      currency: "MXN",
      termsVersion: 1,
      termsText: input.termsText ?? "",
      status: input.status ?? "draft",
      conditions,
      deletedAt: null,
      deletedBy: null,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.saveProduct(product, this.productEvent(principal, correlationId, product.id, "created", at));
    return adminProduct(product);
  }

  async updateProduct(sessionToken: string, id: string, input: ProductWrite, correlationId: string) {
    const principal = await this.principal(sessionToken, "products:update");
    const current = await this.liveProduct(id);
    const category = await this.liveCategory(input.categoryId);
    const conditions = assertConditions(category.code, input.conditions ?? current.conditions);
    const termsText = input.termsText ?? current.termsText;
    const at = this.clock.now().toISOString();
    const next: ProductRecord = {
      ...current,
      categoryId: category.id,
      code: assertCode(input.code),
      name: assertName(input.name),
      summary: input.summary ?? current.summary,
      description: input.description ?? current.description,
      termsText,
      termsVersion: termsText === current.termsText ? current.termsVersion : current.termsVersion + 1,
      status: input.status ?? current.status,
      conditions,
      updatedAt: at,
    };
    await this.store.saveProduct(next, this.productEvent(principal, correlationId, next.id, "updated", at));
    return adminProduct(next);
  }

  async deleteProduct(sessionToken: string, id: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "products:delete");
    const at = this.clock.now().toISOString();
    const product = await this.store.deleteProduct(id, principal.userId, at, (disabled) => [
      this.productEvent(principal, correlationId, id, "deleted", at),
      ...disabled.map((offerId) => this.offerEvent(principal, correlationId, offerId, "updated", at)),
    ]);
    if (!product) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "El producto no está disponible");
    }
  }

  async restoreProduct(sessionToken: string, id: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "products:restore");
    const at = this.clock.now().toISOString();
    const product = await this.store.restoreProduct(id, at, this.productEvent(principal, correlationId, id, "restored", at));
    if (!product) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "El producto no está disponible");
    }
    return adminProduct(product);
  }

  async listAdminOffers(sessionToken: string, query: PageQuery, includeDeleted: boolean) {
    await this.readAdmin(sessionToken, "offers:read", "offers:read:deleted", includeDeleted);
    const page = await this.store.listOffers(query, includeDeleted);
    return { ...page, items: page.items.map(adminOffer) };
  }

  async getAdminOffer(sessionToken: string, id: string) {
    await this.principal(sessionToken, "offers:read");
    return adminOffer(await this.liveOffer(id));
  }

  async createOffer(sessionToken: string, input: OfferWrite, correlationId: string) {
    const principal = await this.principal(sessionToken, "offers:create");
    await this.liveProduct(input.productId);
    const at = this.clock.now().toISOString();
    const offer = this.offerFrom(input, this.ids.uuid(), at);
    await this.store.saveOffer(offer, this.offerEvent(principal, correlationId, offer.id, "created", at));
    return adminOffer(offer);
  }

  async updateOffer(sessionToken: string, id: string, input: OfferWrite, correlationId: string) {
    const principal = await this.principal(sessionToken, "offers:update");
    const current = await this.liveOffer(id);
    await this.liveProduct(input.productId);
    const at = this.clock.now().toISOString();
    const next = { ...this.offerFrom(input, current.id, current.createdAt), updatedAt: at, deletedAt: null, deletedBy: null };
    await this.store.saveOffer(next, this.offerEvent(principal, correlationId, next.id, "updated", at));
    return adminOffer(next);
  }

  async deleteOffer(sessionToken: string, id: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "offers:delete");
    const at = this.clock.now().toISOString();
    const offer = await this.store.deleteOffer(id, principal.userId, at, this.offerEvent(principal, correlationId, id, "deleted", at));
    if (!offer) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La oferta no está disponible");
    }
  }

  async restoreOffer(sessionToken: string, id: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "offers:restore");
    const at = this.clock.now().toISOString();
    const offer = await this.store.restoreOffer(id, at, this.offerEvent(principal, correlationId, id, "restored", at));
    if (!offer) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La oferta no está disponible");
    }
    return adminOffer(offer);
  }

  async replaceRules(sessionToken: string, offerId: string, rules: RuleWrite[], correlationId: string) {
    const principal = await this.principal(sessionToken, "offers:rules:manage");
    const offer = await this.liveOffer(offerId);
    if (offer.audienceType !== "rules") {
      throw new CatalogError("BUSINESS_RULE", "Las reglas solo aplican a una audiencia por reglas");
    }
    if (rules.length > 10) {
      throw new CatalogError("VALIDATION_ERROR", "Hay demasiadas reglas", [{ field: "rules", code: "max" }]);
    }
    const at = this.clock.now().toISOString();
    const stored = rules.map((rule) => ({ id: this.ids.uuid(), offerId, ...assertRule(rule) }));
    await this.store.replaceRules(offerId, stored, this.offerEvent(principal, correlationId, offerId, "rules_replaced", at));
    return adminOffer(offer);
  }

  async listAssignments(sessionToken: string, offerId: string, query: PageQuery) {
    await this.principal(sessionToken, "offers:assignments:read");
    await this.liveOffer(offerId);
    const page = await this.store.listAssignments(offerId, query);
    return { ...page, items: page.items.map(assignmentView) };
  }

  async createAssignment(sessionToken: string, offerId: string, customerId: string, reason: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "offers:assign");
    const offer = await this.liveOffer(offerId);
    if (offer.audienceType !== "direct") {
      throw new CatalogError("BUSINESS_RULE", "La asignación directa exige una audiencia dirigida");
    }
    const context = await this.accounts.eligibility(customerId, []);
    if (!context.verifiable) {
      throw new CatalogError("BUSINESS_RULE", "El cliente no es verificable");
    }
    const at = this.clock.now().toISOString();
    const assignment: AssignmentRecord = {
      id: this.ids.uuid(),
      offerId,
      customerId,
      assignedBy: principal.userId,
      reason: assertReason(reason),
      deletedAt: null,
      deletedBy: null,
      createdAt: at,
    };
    await this.store.saveAssignment(assignment, this.offerEvent(principal, correlationId, offerId, "assignment_changed", at));
    return assignmentView(assignment);
  }

  async deleteAssignment(sessionToken: string, offerId: string, assignmentId: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "offers:assign");
    const at = this.clock.now().toISOString();
    const removed = await this.store.deleteAssignment(offerId, assignmentId, principal.userId, at, this.offerEvent(principal, correlationId, offerId, "assignment_changed", at));
    if (!removed) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La asignación no está disponible");
    }
  }

  private async visibleOffers(customerId: string, query: PageQuery) {
    const offers = await this.eligibleOffers(customerId);
    const sorted = sortRecords(offers, query.sort);
    const start = (query.page - 1) * query.pageSize;
    return { items: sorted.slice(start, start + query.pageSize).map(publicOffer), totalItems: offers.length };
  }

  private async oneVisibleOffer(customerId: string, id: string) {
    const offers = await this.eligibleOffers(customerId);
    const found = offers.find((offer) => offer.id === id);
    if (!found) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La oferta no está disponible");
    }
    return publicOffer(found);
  }

  private async eligibleOffers(customerId: string) {
    const offers = await this.store.candidateOffers();
    const rules = await this.store.rulesOf(offers.map((offer) => offer.id));
    const assigned = new Set(await this.store.assignedOfferIds(customerId, offers.filter((offer) => offer.audienceType === "direct").map((offer) => offer.id)));
    const context = offers.some((offer) => offer.audienceType === "rules") ? await this.contextFor(customerId, rules) : null;
    const now = this.clock.now();
    return offers.filter((offer) => decideOffer({
      offer,
      rules: rules.filter((rule) => rule.offerId === offer.id),
      assigned: assigned.has(offer.id),
      context: offer.audienceType === "rules" ? context : null,
      now,
    }).eligible);
  }

  private async contextFor(customerId: string, rules: readonly RuleRecord[]): Promise<FinancialContext> {
    const fields: Array<"totalBalance" | "accountAgeDays"> = [];
    if (rules.some((rule) => rule.field === "totalBalance")) {
      fields.push("totalBalance");
    }
    if (rules.some((rule) => rule.field === "accountAgeDays")) {
      fields.push("accountAgeDays");
    }
    if (fields.length === 0) {
      fields.push("totalBalance");
    }
    return this.accounts.eligibility(customerId, fields);
  }

  private async visibleProduct(id: string) {
    const product = await this.store.findProduct(id);
    if (!product || product.deletedAt || product.status !== "active") {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "El producto no está disponible");
    }
    const category = await this.store.findCategory(product.categoryId);
    if (!category || category.deletedAt || category.status !== "active") {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "El producto no está disponible");
    }
    return product;
  }

  private async liveCategory(id: string) {
    const category = await this.store.findCategory(id);
    if (!category || category.deletedAt) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La categoría no está disponible");
    }
    return category;
  }

  private async liveProduct(id: string) {
    const product = await this.store.findProduct(id);
    if (!product || product.deletedAt) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "El producto no está disponible");
    }
    return product;
  }

  private async liveOffer(id: string) {
    const offer = await this.store.findOffer(id);
    if (!offer || offer.deletedAt) {
      throw new CatalogError("RESOURCE_NOT_VISIBLE", "La oferta no está disponible");
    }
    return offer;
  }

  private async readAdmin(sessionToken: string, permission: string, deletedPermission: string, includeDeleted: boolean) {
    const principal = await this.principal(sessionToken, permission);
    if (includeDeleted) {
      await this.principal(sessionToken, deletedPermission);
    }
    return principal;
  }

  private async principal(sessionToken: string, permission: string): Promise<Principal> {
    return this.authorizer.authorize(sessionToken, permission, false);
  }

  private newCategory(input: CategoryWrite): CategoryRecord {
    const at = this.clock.now().toISOString();
    return {
      id: this.ids.uuid(),
      ...this.categoryFields(input),
      deletedAt: null,
      deletedBy: null,
      createdAt: at,
      updatedAt: at,
    };
  }

  private categoryFields(input: CategoryWrite) {
    return {
      code: assertCode(input.code),
      name: assertName(input.name),
      description: input.description ?? "",
      status: input.status ?? "active" as const,
    };
  }

  private offerFrom(input: OfferWrite, id: string, createdAt: string): OfferRecord {
    assertWindow(input.startsAt, input.endsAt);
    const priority = input.priority ?? 0;
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
      throw new CatalogError("VALIDATION_ERROR", "La prioridad no es válida", [{ field: "priority", code: "invalid" }]);
    }
    return {
      id,
      productId: input.productId,
      code: assertCode(input.code),
      title: assertName(input.title),
      description: input.description ?? "",
      benefitType: "information",
      benefitValue: input.benefitValue ?? "",
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      priority,
      audienceType: input.audienceType,
      status: input.status ?? "draft",
      deletedAt: null,
      deletedBy: null,
      createdAt,
      updatedAt: createdAt,
    };
  }

  private productEvent(principal: Principal, correlationId: string, productId: string, change: ProductChange, at: string): OutboxRecord {
    return {
      id: this.ids.uuid(),
      eventType: "product.changed",
      aggregateId: productId,
      actorId: principal.userId,
      correlationId,
      payload: { product_id: productId, change },
      occurredAt: at,
      publishedAt: null,
    };
  }

  private offerEvent(principal: Principal, correlationId: string, offerId: string, change: OfferChange, at: string): OutboxRecord {
    return {
      id: this.ids.uuid(),
      eventType: "offer.changed",
      aggregateId: offerId,
      actorId: principal.userId,
      correlationId,
      payload: { offer_id: offerId, change },
      occurredAt: at,
      publishedAt: null,
    };
  }
}

function categoryView(category: CategoryRecord) {
  return { id: category.id, code: category.code, name: category.name, description: category.description, status: category.status };
}

function publicProduct(product: ProductRecord) {
  return {
    id: product.id,
    categoryId: product.categoryId,
    code: product.code,
    name: product.name,
    summary: product.summary,
    description: product.description,
    currency: product.currency,
    termsVersion: product.termsVersion,
    termsText: product.termsText,
  };
}

function adminProduct(product: ProductRecord) {
  return { ...publicProduct(product), status: product.status, conditions: product.conditions };
}

function publicOffer(offer: OfferRecord) {
  return {
    id: offer.id,
    productId: offer.productId,
    code: offer.code,
    title: offer.title,
    description: offer.description,
    benefitType: offer.benefitType,
    benefitValue: offer.benefitValue,
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    eligible: true as const,
    status: "active" as const,
  };
}

function adminOffer(offer: OfferRecord) {
  return {
    id: offer.id,
    productId: offer.productId,
    code: offer.code,
    title: offer.title,
    description: offer.description,
    benefitType: offer.benefitType,
    benefitValue: offer.benefitValue,
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    priority: offer.priority,
    audienceType: offer.audienceType,
    status: offer.status,
  };
}

function assignmentView(assignment: AssignmentRecord) {
  return { id: assignment.id, offerId: assignment.offerId, customerId: assignment.customerId, reason: assignment.reason };
}

function assertCode(value: string): string {
  if (!CODE.test(value) || value.length > 64) {
    throw new CatalogError("VALIDATION_ERROR", "El código no es válido", [{ field: "code", code: "invalid" }]);
  }
  return value;
}

function assertName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new CatalogError("VALIDATION_ERROR", "El nombre no es válido", [{ field: "name", code: "invalid" }]);
  }
  return trimmed;
}

function assertReason(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 300) {
    throw new CatalogError("VALIDATION_ERROR", "El motivo no es válido", [{ field: "reason", code: "invalid" }]);
  }
  return trimmed;
}

function assertWindow(startsAt?: string | null, endsAt?: string | null): void {
  if (startsAt && Number.isNaN(Date.parse(startsAt))) {
    throw new CatalogError("VALIDATION_ERROR", "La vigencia no es válida", [{ field: "startsAt", code: "invalid" }]);
  }
  if (endsAt && Number.isNaN(Date.parse(endsAt))) {
    throw new CatalogError("VALIDATION_ERROR", "La vigencia no es válida", [{ field: "endsAt", code: "invalid" }]);
  }
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new CatalogError("VALIDATION_ERROR", "La vigencia termina antes de empezar", [{ field: "endsAt", code: "invalid" }]);
  }
}

function assertRule(rule: RuleWrite): Pick<RuleRecord, "field" | "operator" | "value"> {
  if (!RULE_FIELDS.includes(rule.field) || !OPERATORS.includes(rule.operator)) {
    throw new CatalogError("VALIDATION_ERROR", "La regla no está permitida", [{ field: "rules", code: "invalid" }]);
  }
  const money = /^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
  const days = /^(0|[1-9][0-9]{0,5})$/;
  if ((rule.field === "totalBalance" && !money.test(rule.value)) || (rule.field === "accountAgeDays" && !days.test(rule.value)) || rule.value.length > 40) {
    throw new CatalogError("VALIDATION_ERROR", "El valor de la regla no es válido", [{ field: "value", code: "invalid" }]);
  }
  return { field: rule.field, operator: rule.operator, value: rule.value };
}

function sortRecords<T extends { createdAt: string; id: string }>(items: T[], sort: PageQuery["sort"]): T[] {
  const factor = sort === "createdAt" ? 1 : -1;
  return [...items].sort((left, right) => {
    const compared = left.createdAt.localeCompare(right.createdAt);
    return (compared === 0 ? left.id.localeCompare(right.id) : compared) * factor;
  });
}
