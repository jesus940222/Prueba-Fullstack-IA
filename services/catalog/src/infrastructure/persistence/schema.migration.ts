import type { MigrationInterface, QueryRunner } from "typeorm";

export class CatalogSchema1732200000000 implements MigrationInterface {
  name = "CatalogSchema1732200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id uuid PRIMARY KEY,
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        status text NOT NULL CHECK (status IN ('active', 'disabled')),
        deleted_at timestamptz,
        deleted_by uuid,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS products (
        id uuid PRIMARY KEY,
        category_id uuid NOT NULL REFERENCES categories(id),
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        summary text NOT NULL DEFAULT '',
        description text NOT NULL DEFAULT '',
        currency text NOT NULL CHECK (currency = 'MXN'),
        terms_version integer NOT NULL CHECK (terms_version >= 1),
        terms_text text NOT NULL DEFAULT '',
        status text NOT NULL CHECK (status IN ('draft', 'active', 'disabled')),
        deleted_at timestamptz,
        deleted_by uuid,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id, created_at, id);
      CREATE TABLE IF NOT EXISTS product_conditions (
        product_id uuid PRIMARY KEY REFERENCES products(id),
        schema_version integer NOT NULL CHECK (schema_version >= 1),
        attributes jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS offers (
        id uuid PRIMARY KEY,
        product_id uuid NOT NULL REFERENCES products(id),
        code text NOT NULL UNIQUE,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        benefit_type text NOT NULL CHECK (benefit_type = 'information'),
        benefit_value text NOT NULL DEFAULT '',
        starts_at timestamptz,
        ends_at timestamptz,
        priority integer NOT NULL CHECK (priority >= 0 AND priority <= 1000),
        audience_type text NOT NULL CHECK (audience_type IN ('general', 'rules', 'direct')),
        status text NOT NULL CHECK (status IN ('draft', 'active', 'disabled')),
        deleted_at timestamptz,
        deleted_by uuid,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS offers_product_idx ON offers (product_id, created_at, id);
      CREATE TABLE IF NOT EXISTS eligibility_rules (
        id uuid PRIMARY KEY,
        offer_id uuid NOT NULL REFERENCES offers(id),
        field text NOT NULL CHECK (field IN ('totalBalance', 'accountAgeDays')),
        operator text NOT NULL CHECK (operator IN ('eq', 'gte', 'lte')),
        value text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS offer_assignments (
        id uuid PRIMARY KEY,
        offer_id uuid NOT NULL REFERENCES offers(id),
        customer_id uuid NOT NULL,
        assigned_by uuid NOT NULL,
        reason text NOT NULL,
        deleted_at timestamptz,
        deleted_by uuid,
        created_at timestamptz NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS offer_assignments_active
        ON offer_assignments (offer_id, customer_id) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS outbox_events (
        id uuid PRIMARY KEY,
        event_type text NOT NULL,
        aggregate_id uuid NOT NULL,
        actor_id uuid NOT NULL,
        correlation_id uuid NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        published_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox_events (occurred_at) WHERE published_at IS NULL;
    `);
  }

  public async down(): Promise<void> {
    return undefined;
  }
}
