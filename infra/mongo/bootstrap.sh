#!/bin/bash
set -euo pipefail

for value in "${MONGO_ROOT_PASSWORD}" "${AUDIT_CONSUMER_PASSWORD}" "${AUDIT_API_PASSWORD}" "${AUDIT_MIGRATOR_PASSWORD}"; do
  if [[ ! "$value" =~ ^[0-9a-f]+$ ]]; then
    echo "invalid_identifier" >&2
    exit 1
  fi
done

uri="mongodb://${MONGO_ROOT_USER}:${MONGO_ROOT_PASSWORD}@mongo:27017/admin"
for _ in $(seq 1 30); do
  if mongosh "${uri}" --quiet --eval "db.adminCommand({ ping: 1 }).ok" | grep -q 1; then
    break
  fi
  sleep 2
done

mongosh "${uri}" --quiet --file /provision.js
echo "mongo_bootstrap_ok"
