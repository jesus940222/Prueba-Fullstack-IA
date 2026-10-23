import type { FinancialContext } from "../domain/eligibility";
import type { PageQuery } from "../domain/pagination";
import type {
  AssignmentRecord,
  CategoryRecord,
  OfferRecord,
  OutboxRecord,
  ProductRecord,
  RuleRecord,
} from "../domain/records";

export interface Principal {
  userId: string;
  sessionId: string;
}

export interface Authorizer {
  authorize(sessionToken: string, permission: string, requireRecentVerification: boolean): Promise<Principal>;
}

export interface Clock {
  now(): Date;
}

export interface Ids {
  uuid(): string;
}

export interface AccountsContext {
  customerIdForUser(userId: string): Promise<string | null>;
  eligibility(customerId: string, fields: Array<"totalBalance" | "accountAgeDays">): Promise<FinancialContext>;
}

export interface Page<T> {
  items: T[];
  totalItems: number;
}

export interface ProductScope {
  includeDeleted: boolean;
  activeOnly: boolean;
  categoryId?: string;
}

export interface CatalogStore {
  listCategories(query: PageQuery, includeDeleted: boolean, activeOnly: boolean): Promise<Page<CategoryRecord>>;
  findCategory(id: string): Promise<CategoryRecord | null>;
  saveCategory(category: CategoryRecord): Promise<void>;
  listProducts(query: PageQuery, scope: ProductScope): Promise<Page<ProductRecord>>;
  findProduct(id: string): Promise<ProductRecord | null>;
  saveProduct(product: ProductRecord, event: OutboxRecord): Promise<void>;
  deleteProduct(id: string, actorId: string, at: string, eventsFor: (disabledOfferIds: string[]) => OutboxRecord[]): Promise<ProductRecord | null>;
  restoreProduct(id: string, at: string, event: OutboxRecord): Promise<ProductRecord | null>;
  listOffers(query: PageQuery, includeDeleted: boolean): Promise<Page<OfferRecord>>;
  findOffer(id: string): Promise<OfferRecord | null>;
  saveOffer(offer: OfferRecord, event: OutboxRecord): Promise<void>;
  deleteOffer(id: string, actorId: string, at: string, event: OutboxRecord): Promise<OfferRecord | null>;
  restoreOffer(id: string, at: string, event: OutboxRecord): Promise<OfferRecord | null>;
  candidateOffers(): Promise<OfferRecord[]>;
  rulesOf(offerIds: readonly string[]): Promise<RuleRecord[]>;
  replaceRules(offerId: string, rules: RuleRecord[], event: OutboxRecord): Promise<void>;
  listAssignments(offerId: string, query: PageQuery): Promise<Page<AssignmentRecord>>;
  assignedOfferIds(customerId: string, offerIds: readonly string[]): Promise<string[]>;
  saveAssignment(assignment: AssignmentRecord, event: OutboxRecord): Promise<void>;
  deleteAssignment(offerId: string, assignmentId: string, actorId: string, at: string, event: OutboxRecord): Promise<boolean>;
  unpublishedOutbox(limit: number): Promise<OutboxRecord[]>;
  markOutboxPublished(ids: readonly string[], at: string): Promise<void>;
}

export interface EventBroker {
  publish(events: readonly OutboxRecord[]): Promise<void>;
}
