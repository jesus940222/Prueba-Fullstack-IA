import type { MigrationInterface, QueryRunner } from "typeorm";

export class AccountsSchema1732100000000 implements MigrationInterface {
  name = "AccountsSchema1732100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id uuid PRIMARY KEY,
        customer_number text NOT NULL UNIQUE,
        given_name text NOT NULL,
        family_name text NOT NULL,
        status text NOT NULL CHECK (status IN ('active', 'disabled')),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_customers (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL UNIQUE,
        customer_id uuid NOT NULL REFERENCES customers(id),
        status text NOT NULL CHECK (status IN ('active', 'disabled')),
        created_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id uuid PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers(id),
        account_number text NOT NULL UNIQUE,
        name text NOT NULL,
        currency text NOT NULL CHECK (currency = 'MXN'),
        status text NOT NULL CHECK (status IN ('active', 'closed')),
        balance numeric(18,2) NOT NULL CHECK (balance >= 0),
        closed_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS accounts_customer_idx ON accounts (customer_id, created_at, id);
      CREATE TABLE IF NOT EXISTS beneficiaries (
        id uuid PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers(id),
        destination_account_id uuid NOT NULL REFERENCES accounts(id),
        alias text NOT NULL,
        status text NOT NULL CHECK (status IN ('active', 'deleted')),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        deleted_at timestamptz,
        deleted_by uuid
      );
      CREATE UNIQUE INDEX IF NOT EXISTS beneficiaries_active_destination
        ON beneficiaries (customer_id, destination_account_id) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS user_transfer_limits (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL UNIQUE,
        currency text NOT NULL CHECK (currency = 'MXN'),
        per_transfer_limit numeric(18,2) NOT NULL CHECK (per_transfer_limit > 0),
        daily_limit numeric(18,2) NOT NULL CHECK (daily_limit > 0),
        updated_by uuid NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfer_proposals (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        session_id uuid NOT NULL,
        source_account_id uuid NOT NULL REFERENCES accounts(id),
        destination_account_id uuid NOT NULL REFERENCES accounts(id),
        destination_label text NOT NULL,
        amount numeric(18,2) NOT NULL CHECK (amount > 0),
        currency text NOT NULL CHECK (currency = 'MXN'),
        concept text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'rejected', 'expired')),
        expires_at timestamptz NOT NULL,
        confirmed_at timestamptz,
        rejection_reason text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS proposals_owner_idx ON transfer_proposals (user_id, session_id, created_at);
      CREATE TABLE IF NOT EXISTS transfers (
        id uuid PRIMARY KEY,
        reference text NOT NULL UNIQUE,
        proposal_id uuid NOT NULL UNIQUE REFERENCES transfer_proposals(id),
        initiated_by uuid NOT NULL,
        source_account_id uuid NOT NULL REFERENCES accounts(id),
        destination_account_id uuid NOT NULL REFERENCES accounts(id),
        destination_label text NOT NULL,
        amount numeric(18,2) NOT NULL CHECK (amount > 0),
        currency text NOT NULL CHECK (currency = 'MXN'),
        concept text NOT NULL,
        status text NOT NULL CHECK (status = 'completed'),
        completed_at timestamptz NOT NULL,
        reversal_of_id uuid
      );
      CREATE TABLE IF NOT EXISTS movements (
        id uuid PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id),
        transfer_id uuid REFERENCES transfers(id),
        type text NOT NULL CHECK (type IN ('opening', 'transfer', 'purchase')),
        direction text NOT NULL CHECK (direction IN ('in', 'out')),
        amount numeric(18,2) NOT NULL CHECK (amount > 0),
        currency text NOT NULL CHECK (currency = 'MXN'),
        balance_after numeric(18,2) NOT NULL CHECK (balance_after >= 0),
        recorded_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS movements_account_idx ON movements (account_id, recorded_at, id);
      CREATE TABLE IF NOT EXISTS idempotency_records (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        operation text NOT NULL,
        idempotency_key text NOT NULL,
        request_hash text NOT NULL,
        transfer_id uuid REFERENCES transfers(id),
        status text NOT NULL CHECK (status IN ('completed', 'rejected')),
        reason_code text,
        expires_at timestamptz NOT NULL,
        UNIQUE (user_id, operation, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS daily_transfer_usage (
        user_id uuid NOT NULL,
        currency text NOT NULL CHECK (currency = 'MXN'),
        day_key date NOT NULL,
        consumed_amount numeric(18,2) NOT NULL CHECK (consumed_amount >= 0),
        PRIMARY KEY (user_id, currency, day_key)
      );
      CREATE TABLE IF NOT EXISTS outbox_events (
        id uuid PRIMARY KEY,
        event_type text NOT NULL,
        aggregate_id uuid NOT NULL,
        actor_id uuid NOT NULL,
        correlation_id uuid NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        published_at timestamptz,
        attempt_count integer NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox_events (occurred_at) WHERE published_at IS NULL;
      CREATE TABLE IF NOT EXISTS recipient_resolve_attempts (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        attempted_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resolve_attempts_idx ON recipient_resolve_attempts (user_id, attempted_at);
    `);
  }

  public async down(): Promise<void> {
    return undefined;
  }
}
