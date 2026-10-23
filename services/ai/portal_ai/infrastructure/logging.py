import json
from datetime import datetime, timezone

_ALLOWED = ("level", "event", "correlationId", "statusCode", "method", "path", "dependency", "errorCode")


def to_log_record(entry: dict, service: str, version: str) -> dict:
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": entry["level"],
        "service": service,
        "version": version,
        "event": entry["event"],
    }
    for key in _ALLOWED:
        if key in ("level", "event"):
            continue
        if key in entry and entry[key] is not None:
            record[key] = entry[key]
    return record
