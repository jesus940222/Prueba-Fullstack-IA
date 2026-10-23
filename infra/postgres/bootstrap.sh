#!/bin/bash
set -euo pipefail

export PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}"

psql_admin() {
  psql -h postgres -U "${POSTGRES_USER}" -d postgres -v ON_ERROR_STOP=1 "$@"
}

ensure_role() {
  local user="$1"
  local pass="$2"
  if [[ ! "$user" =~ ^[a-z_]+$ || ! "$pass" =~ ^[0-9a-f]+$ ]]; then
    echo "invalid_identifier" >&2
    exit 1
  fi
  psql_admin -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${user}') THEN CREATE ROLE ${user} LOGIN PASSWORD '${pass}'; ELSE ALTER ROLE ${user} WITH LOGIN PASSWORD '${pass}'; END IF; END \$\$;"
}

ensure_database() {
  local db="$1"
  local owner="$2"
  if [[ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'")" != "1" ]]; then
    psql_admin -c "CREATE DATABASE ${db} OWNER ${owner};"
  fi
  psql_admin -c "REVOKE ALL ON DATABASE ${db} FROM PUBLIC;"
  psql_admin -c "GRANT CONNECT, TEMP ON DATABASE ${db} TO ${owner};"
  psql -h postgres -U "${POSTGRES_USER}" -d "${db}" -v ON_ERROR_STOP=1 -c "ALTER SCHEMA public OWNER TO ${owner};"
  psql -h postgres -U "${POSTGRES_USER}" -d "${db}" -v ON_ERROR_STOP=1 -c "REVOKE ALL ON SCHEMA public FROM PUBLIC;"
  psql -h postgres -U "${POSTGRES_USER}" -d "${db}" -v ON_ERROR_STOP=1 -c "GRANT USAGE, CREATE ON SCHEMA public TO ${owner};"
}

ensure_role access "${ACCESS_DB_PASSWORD}"
ensure_role accounts "${ACCOUNTS_DB_PASSWORD}"
ensure_role catalog "${CATALOG_DB_PASSWORD}"
ensure_role ai "${AI_DB_PASSWORD}"
ensure_database access access
ensure_database accounts accounts
ensure_database catalog catalog
ensure_database ai ai
echo "postgres_bootstrap_ok"
