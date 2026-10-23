import json

import pytest
from fastapi.testclient import TestClient

from portal_ai.application.capabilities import build_capabilities
from portal_ai.application.readiness import ReadinessService, public_error_code
from portal_ai.domain.correlation import resolve_correlation_id
from portal_ai.domain.platform_limits import PlatformLimits, assert_platform_limits
from portal_ai.infrastructure.config import AppConfig, load_config
from portal_ai.infrastructure.logging import to_log_record
from portal_ai.presentation.api import create_app


def sample_limits() -> PlatformLimits:
    return PlatformLimits(
        "10000.00",
        "10000.00",
        "50000.00",
        "100000.00",
        300,
        300,
        600,
        28800,
        1800,
        300,
        5,
        20,
        100,
        20,
        50,
        "1.00",
        "5.00",
        "25.00",
        [80, 100],
        1800,
        8,
        60,
        3072,
    )


def test_correlation_keeps_only_uuid_v4():
    generated = "11111111-1111-4111-8111-111111111111"
    assert resolve_correlation_id("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", lambda: generated) == (
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    )
    assert resolve_correlation_id("not-a-uuid", lambda: generated) == generated


def test_platform_limits_reject_an_operation_above_the_daily_limit():
    limits = sample_limits()
    assert_platform_limits(limits)
    rejected = PlatformLimits(**{**limits.__dict__, "transfer_per_operation": "10000.01"})
    with pytest.raises(ValueError, match="invalid_transfer_limits"):
        assert_platform_limits(rejected)


def test_readiness_distinguishes_required_and_optional_failures():
    unavailable = ReadinessService("ai", [("postgres", True, lambda: "down")])
    degraded = ReadinessService("ai", [("postgres", True, lambda: "up"), ("qdrant", False, lambda: "not_configured")])
    assert unavailable.execute()["status"] == "unavailable"
    assert degraded.execute()["status"] == "degraded"
    def fail() -> str:
        raise RuntimeError("password=secret")

    hidden = ReadinessService("ai", [("postgres", True, fail)])
    report = hidden.execute()
    assert report["checks"][0]["errorCode"] == "dependency_unreachable"
    assert "secret" not in json.dumps(report)
    assert public_error_code(TimeoutError("timeout")) == "timeout"


def test_config_requires_the_database_and_hides_secret_values(monkeypatch):
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    with pytest.raises(SystemExit, match="AI_DATABASE_URL"):
        load_config()
    monkeypatch.setenv("AI_DATABASE_URL", "postgresql://ai:secret@postgres:5432/ai")
    monkeypatch.setenv("AI_BUDGET_RUN_USD", "9.00")
    with pytest.raises(SystemExit) as caught:
        load_config()
    assert "secret" not in str(caught.value)


def test_log_record_drops_unlisted_fields():
    record = to_log_record({"level": "error", "event": "dependency_check", "password": "secret"}, "ai", "0.2.0")
    assert "secret" not in json.dumps(record)


def test_capabilities_do_not_echo_or_verify_credentials():
    report = build_capabilities("sk-secret", "http://qdrant:6333", False, "ls-secret")
    assert report["capabilities"][0]["status"] == "configured"
    assert report["capabilities"][0]["verified"] is False
    assert report["capabilities"][2]["status"] == "missing"
    assert "sk-secret" not in json.dumps(report)


def test_ready_returns_503_without_leaking_config():
    config = AppConfig(
        "postgresql://ai:secret@postgres/ai",
        "",
        "",
        "sk-secret",
        False,
        "",
        3072,
        3005,
    )
    app = create_app(ReadinessService("ai", [("postgres", True, lambda: "down")]), config)
    client = TestClient(app)
    failed = client.get("/ready")
    assert failed.status_code == 503
    assert "secret" not in failed.text
    healthy = client.get("/health")
    assert healthy.status_code == 200
    capabilities = client.get("/capabilities")
    assert capabilities.json()["capabilities"][0]["verified"] is False
    echoed = client.get("/ready", headers={"x-correlation-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"})
    assert echoed.headers["x-correlation-id"] == "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
