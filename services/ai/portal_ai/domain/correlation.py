import re

_UUID_V4 = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def resolve_correlation_id(raw: str | None, next_id) -> str:
    value = (raw or "").strip()
    if _UUID_V4.fullmatch(value):
        return value.lower()
    return next_id()
