import json
import re
from dataclasses import dataclass


UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MONEY = re.compile(r"^(0|[1-9][0-9]{0,15})\.[0-9]{2}$")
ACCOUNT = re.compile(r"^[0-9]{10,18}$")


@dataclass(frozen=True)
class ToolSpec:
    name: str
    permission: str
    mutating: bool
    schema: dict


def _object(properties: dict, required: list[str]) -> dict:
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": required}


TOOL_SPECS: dict[str, ToolSpec] = {
    "search_documentation": ToolSpec(
        "search_documentation",
        "ai:chat:use",
        False,
        _object({"query": {"type": "string", "minLength": 1, "maxLength": 200}}, ["query"]),
    ),
    "list_my_accounts": ToolSpec("list_my_accounts", "accounts:read:own", False, _object({}, [])),
    "list_my_transactions": ToolSpec(
        "list_my_transactions",
        "transactions:read:own",
        False,
        _object(
            {
                "accountId": {"type": "string", "format": "uuid"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            ["accountId"],
        ),
    ),
    "list_my_beneficiaries": ToolSpec(
        "list_my_beneficiaries",
        "beneficiaries:read:own",
        False,
        _object(
            {
                "cursor": {"type": "string", "maxLength": 512},
                "search": {"type": "string", "maxLength": 80},
            },
            [],
        ),
    ),
    "get_my_transfer_limits": ToolSpec("get_my_transfer_limits", "transfer-limits:read:own", False, _object({}, [])),
    "list_products": ToolSpec(
        "list_products",
        "products:read",
        False,
        _object({"page": {"type": "integer", "minimum": 1, "maximum": 100}}, []),
    ),
    "list_my_offers": ToolSpec("list_my_offers", "offers:read:own", False, _object({}, [])),
    "prepare_transfer": ToolSpec(
        "prepare_transfer",
        "transfers:create:own",
        True,
        _object(
            {
                "sourceAccountId": {"type": "string", "format": "uuid"},
                "beneficiaryId": {"type": "string", "format": "uuid"},
                "destinationAccountNumber": {"type": "string", "pattern": ACCOUNT.pattern},
                "amount": {"type": "string", "pattern": MONEY.pattern},
                "currency": {"const": "MXN"},
                "concept": {"type": "string", "minLength": 1, "maxLength": 140},
            },
            ["sourceAccountId", "amount", "currency", "concept"],
        ),
    ),
}


FORBIDDEN_TOOLS = {
    "confirm_transfer",
    "execute_sql",
    "http_request",
    "shell",
    "manage_roles",
    "reset_password",
}


def known_tools() -> list[ToolSpec]:
    return list(TOOL_SPECS.values())


def validate_arguments(name: str, arguments: dict) -> dict:
    if name in FORBIDDEN_TOOLS or name not in TOOL_SPECS:
        raise ValueError("unknown_tool")
    if not isinstance(arguments, dict):
        raise ValueError("invalid_arguments")
    if "userId" in arguments or "sessionId" in arguments or "sql" in arguments or "url" in arguments:
        raise ValueError("invalid_arguments")
    schema = TOOL_SPECS[name].schema
    allowed = set(schema["properties"])
    if any(key not in allowed for key in arguments):
        raise ValueError("invalid_arguments")
    for key in schema["required"]:
        if key not in arguments:
            raise ValueError("invalid_arguments")
    cleaned: dict = {}
    for key, value in arguments.items():
        rule = schema["properties"][key]
        cleaned[key] = _check(rule, value)
    if name == "prepare_transfer":
        has_beneficiary = "beneficiaryId" in cleaned
        has_account = "destinationAccountNumber" in cleaned
        if has_beneficiary == has_account:
            raise ValueError("invalid_arguments")
    return cleaned


def _check(rule: dict, value: object) -> object:
    if "const" in rule:
        if value != rule["const"]:
            raise ValueError("invalid_arguments")
        return value
    kind = rule.get("type")
    if kind == "string":
        if not isinstance(value, str):
            raise ValueError("invalid_arguments")
        if "minLength" in rule and len(value) < rule["minLength"]:
            raise ValueError("invalid_arguments")
        if "maxLength" in rule and len(value) > rule["maxLength"]:
            raise ValueError("invalid_arguments")
        if rule.get("format") == "uuid" and UUID.fullmatch(value.lower()) is None:
            raise ValueError("invalid_arguments")
        if "pattern" in rule and re.fullmatch(rule["pattern"], value) is None:
            raise ValueError("invalid_arguments")
        return value
    if kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("invalid_arguments")
        if value < rule.get("minimum", value) or value > rule.get("maximum", value):
            raise ValueError("invalid_arguments")
        return value
    raise ValueError("invalid_arguments")


def canonical_arguments(arguments: dict) -> str:
    return json.dumps(arguments, sort_keys=True, separators=(",", ":"))
