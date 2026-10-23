from datetime import datetime, timedelta, timezone


def allow_message(stamps: list[str], now: str, limit: int, window_seconds: int) -> bool:
    current = datetime.fromisoformat(now.replace("Z", "+00:00"))
    threshold = current - timedelta(seconds=window_seconds)
    recent = [stamp for stamp in stamps if datetime.fromisoformat(stamp.replace("Z", "+00:00")) > threshold]
    return len(recent) < limit


def mexico_day_bounds(now: str) -> tuple[str, str]:
    from zoneinfo import ZoneInfo

    current = datetime.fromisoformat(now.replace("Z", "+00:00")).astimezone(ZoneInfo("America/Mexico_City"))
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()
