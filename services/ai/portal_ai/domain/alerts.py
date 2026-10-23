from dataclasses import dataclass


@dataclass(frozen=True)
class AlertDecision:
    emit: bool
    reason: str


def decide_alert(
    enabled: bool,
    observed: str,
    threshold: str,
    existing_same_window: bool,
    last_emitted_at: str | None,
    now: str,
    cooldown_seconds: int,
) -> AlertDecision:
    from portal_ai.domain.budget import percent_reached

    if not enabled:
        return AlertDecision(False, "disabled")
    if not percent_reached(observed, threshold):
        return AlertDecision(False, "below")
    if existing_same_window:
        return AlertDecision(False, "duplicate")
    if last_emitted_at is not None and _elapsed(last_emitted_at, now) < cooldown_seconds:
        return AlertDecision(False, "cooldown")
    return AlertDecision(True, "emit")


def _elapsed(start: str, end: str) -> int:
    from datetime import datetime

    opened = datetime.fromisoformat(start.replace("Z", "+00:00"))
    current = datetime.fromisoformat(end.replace("Z", "+00:00"))
    return int((current - opened).total_seconds())
