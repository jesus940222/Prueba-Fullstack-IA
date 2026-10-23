"""Comprueba los contratos de la fase 1. No arranca servicios ni llama a proveedores."""

import json
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError

ROOT = Path(__file__).resolve().parents[1]
UUID = "11111111-1111-4111-8111-111111111111"
WHEN = "2026-10-21T16:00:00Z"


def load_yaml(path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def fail(errors, message):
    errors.append(message)


def check_permissions(errors):
    catalog = load_yaml(ROOT / "contratos" / "permisos.yaml")
    codes = [item["code"] for item in catalog["permissions"]]
    if len(codes) != len(set(codes)):
        fail(errors, "Hay códigos de permiso duplicados")
    for code in codes:
        if "/" in code or "*" in code or " " in code:
            fail(errors, f"Código no canónico: {code}")
    known = set(codes)
    for role, data in catalog["roles"].items():
        unknown = [code for code in data["permissions"] if code not in known]
        if unknown:
            fail(errors, f"{role} usa códigos inexistentes: {unknown}")
        if len(data["permissions"]) != len(set(data["permissions"])):
            fail(errors, f"{role} repite permisos")
    admin = set(catalog["roles"]["administrador"]["permissions"])
    gestor = set(catalog["roles"]["gestor-catalogo"]["permissions"])
    cliente = set(catalog["roles"]["cliente"]["permissions"])
    soporte = set(catalog["roles"]["soporte"]["permissions"])
    auditor = set(catalog["roles"]["auditor"]["permissions"])
    forbidden_admin = {
        "accounts:read:own",
        "transfers:create:own",
        "audit:read:any",
        "categories:create",
        "ai:documents:read",
        "offers:read:any",
    }
    leaked = sorted(admin & forbidden_admin)
    if leaked:
        fail(errors, f"El administrador recibe capacidades fuera de su matriz: {leaked}")
    if "ai:documents:read" not in gestor or "ai:documents:reindex" not in gestor:
        fail(errors, "El gestor no administra los documentos RAG")
    if "transfers:create:own" in gestor or "users:create" in gestor:
        fail(errors, "El gestor recibe dinero o identidad")
    if not {"users:read", "security:recovery:initiate"} <= soporte:
        fail(errors, "Soporte no tiene su proyección")
    if "users:update" in soporte or "audit:read:any" not in auditor:
        fail(errors, "Soporte o auditor no respetan la matriz")
    if "security:recovery:complete" in catalog["delegableCustomRolePermissions"]:
        fail(errors, "La recuperación completa no es delegable")
    if not catalog["roles"]["gestor-catalogo"]["assignableByAccessAdmin"] is False:
        fail(errors, "El gestor no debe ser asignable por el administrador de accesos")
    for code in ("audit:read:own", "offers:read:any"):
        if code not in catalog["unassigned"]:
            fail(errors, f"{code} debería quedar sin rol inicial")
        if any(code in data["permissions"] for data in catalog["roles"].values()):
            fail(errors, f"{code} está asignado a un rol inicial")
    personal = {
        "profile:read:own",
        "profile:update:own",
        "security:manage:own",
        "sessions:read:own",
        "sessions:revoke:own",
        "ai:chat:use",
        "ai:metrics:read:own",
    }
    if not personal <= cliente:
        fail(errors, "Al cliente le falta un permiso personal")
    return known


def authorization_codes(auth):
    if "permission" in auth and isinstance(auth["permission"], str):
        return [auth["permission"]]
    return [rule["permission"] for rule in auth.get("anyOf", []) if "permission" in rule]


def check_openapi(errors, known):
    required = {
        "post /api/v1/access/auth/login",
        "get /api/v1/access/.well-known/jwks.json",
        "post /internal/v1/access/authorize",
        "post /api/v1/access/recovery-requests/{id}/complete",
        "post /api/v1/accounts/transfer-proposals/{id}/confirm",
        "post /internal/v1/accounts/eligibility-context",
        "put /api/v1/catalog/admin/offers/{id}/eligibility-rules",
        "delete /api/v1/catalog/admin/offers/{id}/assignments/{assignmentId}",
        "get /api/v1/audit/events",
        "post /api/v1/ai/admin/documents/{id}/reindex",
        "get /api/v1/ai/runs/{id}/events",
    }
    found = set()
    unsafe = {"post", "put", "patch", "delete"}
    for path in (ROOT / "openapi").glob("*.yaml"):
        if path.name == "build_openapi.py":
            continue
        spec = load_yaml(path)
        if spec.get("openapi") != "3.1.0":
            fail(errors, f"{path.name} no es OpenAPI 3.1.0")
        for route, methods in spec["paths"].items():
            if "[" in route or "]" in route:
                fail(errors, f"Ruta abreviada: {route}")
            for method, op in methods.items():
                found.add(f"{method} {route}")
                auth = op.get("x-authorization")
                if not auth or "kind" not in auth:
                    fail(errors, f"Sin autorización: {method} {route}")
                    continue
                for code in authorization_codes(auth):
                    if code not in known:
                        fail(errors, f"Permiso desconocido en {method} {route}: {code}")
                if auth["kind"] in {"permission", "session"} and method in unsafe:
                    schemes = op.get("security", [{}])[0]
                    if "csrfHeader" not in schemes or "sessionCookie" not in schemes:
                        fail(errors, f"Mutación sin cookie y CSRF: {method} {route}")
                if route.endswith("/confirm"):
                    names = {item["name"] for item in op.get("parameters", [])}
                    if "Idempotency-Key" not in names or not auth.get("recentVerification"):
                        fail(errors, "La confirmación no exige clave e verificación reciente")
    missing = sorted(required - found)
    if missing:
        fail(errors, f"Faltan rutas: {missing}")
    if len(found) < 120:
        fail(errors, f"El contrato tiene solo {len(found)} operaciones")
    return found


def envelope(event_type, source, payload):
    return {
        "event_id": UUID,
        "event_type": event_type,
        "schema_version": 1,
        "occurred_at": WHEN,
        "source_service": source,
        "actor_type": "user",
        "actor_id": UUID,
        "correlation_id": UUID,
        "causation_id": None,
        "payload": payload,
    }


def check_events(errors):
    schema = json.loads((ROOT / "contratos" / "eventos" / "bus-envelope-1.schema.json").read_text(encoding="utf-8"))
    audit = json.loads((ROOT / "contratos" / "eventos" / "audit-event-1.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    Draft202012Validator.check_schema(audit)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    samples = [
        envelope("session.revoked", "access", {"session_id": UUID, "user_id": UUID, "reason": "role_changed"}),
        envelope("user.deleted", "access", {"user_id": UUID}),
        envelope("role.updated", "access", {"role_id": UUID, "authorization_version": 2}),
        envelope("role.assignment.changed", "access", {"user_id": UUID, "role_id": UUID, "assignment_id": UUID, "change": "assigned"}),
        envelope("transfer.completed", "accounts", {"transfer_id": UUID, "reference": "T-100", "source_account_id": UUID, "destination_account_id": UUID, "amount": "10.00", "currency": "MXN"}),
        envelope("transfer.rejected", "accounts", {"proposal_id": UUID, "reason_code": "insufficient_funds"}),
        envelope("transfer_limits.updated", "accounts", {"user_id": UUID, "currency": "MXN", "per_transfer_limit": "10000.00", "daily_limit": "10000.00"}),
        envelope("beneficiary.changed", "accounts", {"beneficiary_id": UUID, "customer_id": UUID, "change": "created"}),
        envelope("product.changed", "catalog", {"product_id": UUID, "change": "updated"}),
        envelope("offer.changed", "catalog", {"offer_id": UUID, "change": "rules_replaced"}),
        envelope("ai.run.completed", "ai", {"run_id": UUID, "conversation_id": UUID, "model": "gpt-6-luna", "status": "completed", "usage_complete": False, "estimated_cost_usd": None}),
        envelope("ai.run.failed", "ai", {"run_id": UUID, "conversation_id": UUID, "model": "gpt-6-luna", "status": "failed", "usage_complete": False, "estimated_cost_usd": None}),
        envelope("ai.run.cancelled", "ai", {"run_id": UUID, "conversation_id": UUID, "model": "gpt-6-luna", "status": "cancelled", "usage_complete": True, "estimated_cost_usd": "0.010000"}),
        envelope("ai.cost_alert.created", "ai", {"alert_id": UUID, "rule_id": UUID, "scope": "user_day", "observed_value_usd": "4.00"}),
        envelope("ai.cost_alert.acknowledged", "ai", {"alert_id": UUID}),
        envelope("notification.delivery.failed", "ai", {"delivery_id": UUID, "alert_id": UUID, "channel": "email", "error_code": "smtp_unavailable"}),
    ]
    declared = set(schema["$defs"]["eventType"]["enum"])
    covered = set()
    for sample in samples:
        covered.add(sample["event_type"])
        for error in validator.iter_errors(sample):
            fail(errors, f"{sample['event_type']}: {error.message}")
    if covered != declared:
        fail(errors, f"Ejemplos de eventos incompletos: {sorted(declared - covered)}")
    leaked = envelope("transfer.completed", "accounts", {"transfer_id": UUID, "reference": "T-100", "source_account_id": UUID, "destination_account_id": UUID, "amount": "10.00", "currency": "MXN", "prompt": "secreto"})
    if not list(validator.iter_errors(leaked)):
        fail(errors, "El sobre acepta un campo extra en la transferencia")
    audit_event = {
        "event_id": UUID,
        "event_type": "transfer.completed",
        "schema_version": 1,
        "occurred_at": WHEN,
        "received_at": WHEN,
        "source_service": "accounts",
        "actor_type": "user",
        "actor_id": UUID,
        "customer_id": None,
        "resource_type": "transfer",
        "resource_id": UUID,
        "action": "complete",
        "outcome": "success",
        "reason_code": None,
        "channel": "web",
        "correlation_id": UUID,
        "causation_id": None,
        "changes": [{"field": "balance", "redacted": True}],
        "metadata": {"reference": "T-100"},
    }
    audit_validator = Draft202012Validator(audit, format_checker=FormatChecker())
    for error in audit_validator.iter_errors(audit_event):
        fail(errors, f"Auditoría: {error.message}")


def main():
    errors = []
    known = check_permissions(errors)
    found = check_openapi(errors, known)
    check_events(errors)
    if errors:
        print(f"FALLÓ: {len(errors)}")
        for error in errors:
            print(f"- {error}")
        raise SystemExit(1)
    print(f"Contratos válidos: {len(known)} permisos, {len(found)} operaciones, 16 eventos de ejemplo")


if __name__ == "__main__":
    main()
