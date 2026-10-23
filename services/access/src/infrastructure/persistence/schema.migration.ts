import type { MigrationInterface, QueryRunner } from "typeorm";

export class AccessSchema1732000000000 implements MigrationInterface {
  name = "AccessSchema1732000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        email_normalized text NOT NULL UNIQUE,
        email_verified_at timestamptz,
        given_name text NOT NULL,
        family_name text NOT NULL,
        status text NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
        authorization_version integer NOT NULL,
        theme_preference text NOT NULL CHECK (theme_preference IN ('light', 'dark', 'system')),
        phone_country_code text,
        phone_calling_code text,
        phone_number text,
        phone_e164 text,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        deleted_at timestamptz,
        deleted_by uuid
      );
      CREATE TABLE IF NOT EXISTS password_credentials (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        password_hash text NOT NULL,
        changed_at timestamptz NOT NULL,
        revoked_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS applications (
        id uuid PRIMARY KEY,
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        status text NOT NULL CHECK (status IN ('active', 'disabled')),
        created_at timestamptz NOT NULL,
        deleted_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS permissions (
        id uuid PRIMARY KEY,
        application_id uuid NOT NULL REFERENCES applications(id),
        code text NOT NULL UNIQUE,
        description text NOT NULL DEFAULT '',
        resource text NOT NULL,
        action text NOT NULL,
        scope text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roles (
        id uuid PRIMARY KEY,
        application_id uuid NOT NULL REFERENCES applications(id),
        code text NOT NULL,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        system boolean NOT NULL,
        assignable_by_access_admin boolean NOT NULL,
        version integer NOT NULL,
        created_at timestamptz NOT NULL,
        deleted_at timestamptz,
        UNIQUE (application_id, code)
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        id uuid PRIMARY KEY,
        role_id uuid NOT NULL REFERENCES roles(id),
        permission_id uuid NOT NULL REFERENCES permissions(id),
        assigned_by uuid,
        deleted_at timestamptz,
        deleted_by uuid,
        UNIQUE (role_id, permission_id)
      );
      CREATE TABLE IF NOT EXISTS user_roles (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        role_id uuid NOT NULL REFERENCES roles(id),
        assigned_by uuid,
        expires_at timestamptz,
        created_at timestamptz NOT NULL,
        deleted_at timestamptz,
        deleted_by uuid
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_roles_active ON user_roles (user_id, role_id) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS sessions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        application_code text NOT NULL,
        authentication_method text NOT NULL,
        verified_at timestamptz NOT NULL,
        authorization_version integer NOT NULL,
        restricted boolean NOT NULL,
        csrf_hash text NOT NULL,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        revoked_at timestamptz,
        revocation_reason text
      );
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id uuid PRIMARY KEY,
        session_id uuid NOT NULL REFERENCES sessions(id),
        family_id uuid NOT NULL,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        revoked_at timestamptz,
        replaced_by_id uuid
      );
      CREATE TABLE IF NOT EXISTS auth_challenges (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        purpose text NOT NULL,
        verifier_hash text NOT NULL,
        attempt_count integer NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        binding text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS passkey_policies (
        user_id uuid PRIMARY KEY REFERENCES users(id),
        status text NOT NULL CHECK (status IN ('disabled', 'pending', 'active')),
        enabled_at timestamptz,
        activated_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS passkey_credentials (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        credential_id text NOT NULL UNIQUE,
        public_key text NOT NULL,
        sign_count integer NOT NULL,
        transports text NOT NULL DEFAULT '',
        name text NOT NULL,
        device_type text NOT NULL,
        backed_up boolean NOT NULL,
        created_at timestamptz NOT NULL,
        last_used_at timestamptz,
        revoked_at timestamptz,
        revoked_by uuid
      );
      CREATE TABLE IF NOT EXISTS external_identities (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
        issuer text NOT NULL,
        subject text NOT NULL,
        linked_at timestamptz NOT NULL,
        revoked_at timestamptz,
        UNIQUE (provider, issuer, subject)
      );
      CREATE TABLE IF NOT EXISTS recovery_codes (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        code_hash text NOT NULL,
        used_at timestamptz,
        revoked_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS recovery_requests (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        initiator_user_id uuid NOT NULL,
        reason text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oidc_transactions (
        id uuid PRIMARY KEY,
        state_hash text NOT NULL UNIQUE,
        nonce_hash text NOT NULL,
        verifier text NOT NULL,
        provider text NOT NULL,
        intent text NOT NULL,
        user_id uuid,
        return_to text NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS outbox_events (
        id uuid PRIMARY KEY,
        event_type text NOT NULL,
        aggregate_id uuid NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        published_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS signing_keys (
        kid text PRIMARY KEY,
        public_jwk jsonb NOT NULL,
        private_pkcs8 text NOT NULL,
        created_at timestamptz NOT NULL
      );
    `);
  }

  public async down(): Promise<void> {
    return undefined;
  }
}
