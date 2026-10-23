import re

SECRET_KEYS = {
    "authorization",
    "cookie",
    "csrf",
    "password",
    "secret",
    "api_key",
    "apikey",
    "token",
    "session",
    "otp",
    "reasoning",
    "prompt",
    "input",
    "output",
    "content",
    "arguments",
    "balance",
}

SAFE_METADATA = {"run_id", "model", "status", "step", "service", "prompt_version", "pricing_version", "tool_name"}
SECRET_TEXT = re.compile(r"(sk-[A-Za-z0-9_\-]+|Bearer\s+[A-Za-z0-9._\-]+|portal_session=[^;\s]+)", re.IGNORECASE)


def redact(value: object) -> object:
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if str(key).lower().replace("-", "_") in SECRET_KEYS:
                continue
            cleaned[str(key)] = redact(item)
        return cleaned
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        return SECRET_TEXT.sub("[redacted]", value)
    return value


def safe_metadata(values: dict) -> dict:
    return {key: values[key] for key in SAFE_METADATA if key in values and not isinstance(values[key], (dict, list))}
