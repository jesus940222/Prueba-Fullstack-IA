import os
from dataclasses import dataclass

from portal_ai.domain.platform_limits import PlatformLimits, assert_platform_limits


@dataclass(frozen=True)
class AppConfig:
    database_url: str
    qdrant_url: str
    rabbit_url: str
    openai_api_key: str
    langsmith_tracing: bool
    langsmith_api_key: str
    vector_size: int
    port: int


def _integer(name: str, default: str) -> int:
    raw = os.environ.get(name, default)
    if not raw.isdigit():
        raise SystemExit("invalid_integer")
    return int(raw)


def _text(name: str, default: str) -> str:
    return os.environ.get(name, default)


def load_config() -> AppConfig:
    database_url = os.environ.get("AI_DATABASE_URL", "").strip()
    if database_url == "":
        raise SystemExit("invalid_environment:AI_DATABASE_URL")
    limits = PlatformLimits(
        transfer_per_operation=_text("TRANSFER_LIMIT_PER_OPERATION", "10000.00"),
        transfer_daily=_text("TRANSFER_LIMIT_DAILY", "10000.00"),
        transfer_per_operation_max=_text("TRANSFER_LIMIT_PER_OPERATION_MAX", "50000.00"),
        transfer_daily_max=_text("TRANSFER_LIMIT_DAILY_MAX", "100000.00"),
        proposal_ttl=_integer("TRANSFER_PROPOSAL_TTL", "300"),
        recent_verification_ttl=_integer("RECENT_VERIFICATION_TTL", "300"),
        access_token_ttl=_integer("ACCESS_TOKEN_TTL", "600"),
        session_absolute_ttl=_integer("SESSION_ABSOLUTE_TTL", "28800"),
        session_idle_ttl=_integer("SESSION_IDLE_TTL", "1800"),
        email_code_ttl=_integer("EMAIL_CODE_TTL", "300"),
        email_code_attempts=_integer("EMAIL_CODE_MAX_ATTEMPTS", "5"),
        page_default=_integer("PAGE_SIZE_DEFAULT", "20"),
        page_max=_integer("PAGE_SIZE_MAX", "100"),
        cursor_default=_integer("CURSOR_LIMIT_DEFAULT", "20"),
        cursor_max=_integer("CURSOR_LIMIT_MAX", "50"),
        budget_run=_text("AI_BUDGET_RUN_USD", "1.00"),
        budget_user=_text("AI_BUDGET_USER_DAY_USD", "5.00"),
        budget_global=_text("AI_BUDGET_GLOBAL_DAY_USD", "25.00"),
        warn_percents=[_integer_piece(piece) for piece in _text("AI_BUDGET_WARN_PERCENT", "80,100").split(",")],
        alert_cooldown=_integer("AI_ALERT_COOLDOWN", "1800"),
        max_steps=_integer("AI_MAX_STEPS", "8"),
        run_timeout=_integer("AI_RUN_TIMEOUT", "60"),
        vector_size=_integer("QDRANT_VECTOR_SIZE", "3072"),
    )
    try:
        assert_platform_limits(limits)
    except ValueError as error:
        code = str(error) if str(error).replace("_", "").isalnum() else "invalid_environment"
        raise SystemExit(code) from None
    tracing = os.environ.get("LANGSMITH_TRACING", "false").lower() == "true"
    return AppConfig(
        database_url=database_url,
        qdrant_url=os.environ.get("QDRANT_URL", ""),
        rabbit_url=os.environ.get("RABBITMQ_URL", ""),
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        langsmith_tracing=tracing,
        langsmith_api_key=os.environ.get("LANGSMITH_API_KEY", ""),
        vector_size=limits.vector_size,
        port=_integer("PORT", "3005"),
    )


def _integer_piece(value: str) -> int:
    if not value.isdigit():
        raise SystemExit("invalid_integer")
    return int(value)
