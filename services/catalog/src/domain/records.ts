export type CategoryStatus = "active" | "disabled";
export type PublishStatus = "draft" | "active" | "disabled";
export type AudienceType = "general" | "rules" | "direct";
export type RuleField = "totalBalance" | "accountAgeDays";
export type RuleOperator = "eq" | "gte" | "lte";
export type OfferChange = "created" | "updated" | "deleted" | "restored" | "rules_replaced" | "assignment_changed";
export type ProductChange = "created" | "updated" | "deleted" | "restored";

export interface CategoryRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  status: CategoryStatus;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConditionsRecord {
  schemaVersion: number;
  attributes: Record<string, string | number | boolean>;
}

export interface ProductRecord {
  id: string;
  categoryId: string;
  code: string;
  name: string;
  summary: string;
  description: string;
  currency: "MXN";
  termsVersion: number;
  termsText: string;
  status: PublishStatus;
  conditions: ConditionsRecord;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfferRecord {
  id: string;
  productId: string;
  code: string;
  title: string;
  description: string;
  benefitType: "information";
  benefitValue: string;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  audienceType: AudienceType;
  status: PublishStatus;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleRecord {
  id: string;
  offerId: string;
  field: RuleField;
  operator: RuleOperator;
  value: string;
}

export interface AssignmentRecord {
  id: string;
  offerId: string;
  customerId: string;
  assignedBy: string;
  reason: string;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
}

export interface OutboxRecord {
  id: string;
  eventType: "product.changed" | "offer.changed";
  aggregateId: string;
  actorId: string;
  correlationId: string;
  payload: { product_id?: string; offer_id?: string; change: string };
  occurredAt: string;
  publishedAt: string | null;
}
