import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "categories" })
export class CategoryEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  code!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "text" })
  status!: string;

  @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

@Entity({ name: "products" })
export class ProductEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ name: "category_id", type: "uuid" })
  categoryId!: string;

  @Column({ type: "text" })
  code!: string;

  @Column({ name: "terms_version", type: "int" })
  termsVersion!: number;

  @Column({ type: "text" })
  status!: string;
}

@Entity({ name: "product_conditions" })
export class ProductConditionsEntity {
  @PrimaryColumn({ name: "product_id", type: "uuid" })
  productId!: string;

  @Column({ name: "schema_version", type: "int" })
  schemaVersion!: number;

  @Column({ type: "jsonb" })
  attributes!: Record<string, string | number | boolean>;
}

@Entity({ name: "offers" })
export class OfferEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ name: "product_id", type: "uuid" })
  productId!: string;

  @Column({ name: "audience_type", type: "text" })
  audienceType!: string;

  @Column({ type: "text" })
  status!: string;
}

@Entity({ name: "eligibility_rules" })
export class EligibilityRuleEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ name: "offer_id", type: "uuid" })
  offerId!: string;

  @Column({ type: "text" })
  field!: string;

  @Column({ type: "text" })
  operator!: string;

  @Column({ type: "text" })
  value!: string;
}

@Entity({ name: "offer_assignments" })
export class OfferAssignmentEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ name: "offer_id", type: "uuid" })
  offerId!: string;

  @Column({ name: "customer_id", type: "uuid" })
  customerId!: string;
}

@Entity({ name: "outbox_events" })
export class OutboxEventEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ name: "event_type", type: "text" })
  eventType!: string;

  @Column({ type: "jsonb" })
  payload!: Record<string, string>;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;
}

export const CATALOG_ENTITIES = [
  CategoryEntity,
  ProductEntity,
  ProductConditionsEntity,
  OfferEntity,
  EligibilityRuleEntity,
  OfferAssignmentEntity,
  OutboxEventEntity,
];
