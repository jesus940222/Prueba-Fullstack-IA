import re
from dataclasses import dataclass


@dataclass(frozen=True)
class PlatformLimits:
    transfer_per_operation: str
    transfer_daily: str
    transfer_per_operation_max: str
    transfer_daily_max: str
    proposal_ttl: int
    recent_verification_ttl: int
    access_token_ttl: int
    session_absolute_ttl: int
    session_idle_ttl: int
    email_code_ttl: int
    email_code_attempts: int
    page_default: int
    page_max: int
    cursor_default: int
    cursor_max: int
    budget_run: str
    budget_user: str
    budget_global: str
    warn_percents: list[int]
    alert_cooldown: int
    max_steps: int
    run_timeout: int
    vector_size: int


def _cents(value: str) -> int:
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.[0-9]{2}", value):
        raise ValueError("invalid_decimal")
    whole, fraction = value.split(".")
    return int(whole) * 100 + int(fraction)


def assert_platform_limits(limits: PlatformLimits) -> None:
    per_operation = _cents(limits.transfer_per_operation)
    daily = _cents(limits.transfer_daily)
    per_max = _cents(limits.transfer_per_operation_max)
    daily_max = _cents(limits.transfer_daily_max)
    if per_operation <= 0 or daily <= 0 or per_operation > daily:
        raise ValueError("invalid_transfer_limits")
    if per_max <= 0 or daily_max <= 0 or per_operation > per_max or daily > daily_max:
        raise ValueError("invalid_transfer_ceilings")
    if limits.page_default < 1 or limits.page_max > 100 or limits.page_default > limits.page_max:
        raise ValueError("invalid_page_size")
    if limits.cursor_default < 1 or limits.cursor_max > 50 or limits.cursor_default > limits.cursor_max:
        raise ValueError("invalid_cursor_size")
    run = _cents(limits.budget_run)
    user = _cents(limits.budget_user)
    global_budget = _cents(limits.budget_global)
    if run <= 0 or user <= 0 or global_budget <= 0 or run > user or user > global_budget:
        raise ValueError("invalid_ai_budget")
    if not limits.warn_percents or any(item <= 0 or item > 100 for item in limits.warn_percents):
        raise ValueError("invalid_alert_thresholds")
    if limits.alert_cooldown <= 0 or limits.max_steps <= 0 or limits.run_timeout <= 0:
        raise ValueError("invalid_ai_runtime")
    if limits.vector_size != 3072:
        raise ValueError("invalid_vector_size")
    durations = [
        limits.proposal_ttl,
        limits.recent_verification_ttl,
        limits.access_token_ttl,
        limits.session_absolute_ttl,
        limits.session_idle_ttl,
        limits.email_code_ttl,
        limits.email_code_attempts,
    ]
    if any(item <= 0 for item in durations) or limits.session_idle_ttl > limits.session_absolute_ttl:
        raise ValueError("invalid_session_ttl")
