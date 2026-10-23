import socket
import urllib.request
from urllib.parse import urlparse

from sqlalchemy import create_engine, text

from portal_ai.infrastructure.config import AppConfig


def sqlalchemy_url(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgresql://"):
        return f"postgresql+psycopg://{url.removeprefix('postgresql://')}"
    raise RuntimeError("invalid_database_url")


def probe_postgres(url: str) -> str:
    engine = create_engine(sqlalchemy_url(url), pool_pre_ping=True, connect_args={"connect_timeout": 2})
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return "up"
    finally:
        engine.dispose()


def probe_http(url: str) -> str:
    if url.strip() == "":
        return "not_configured"
    with urllib.request.urlopen(f"{url.rstrip('/')}/healthz", timeout=2) as response:
        if response.status != 200:
            raise RuntimeError("dependency_unreachable")
    return "up"


def probe_tcp(url: str) -> str:
    if url.strip() == "":
        return "not_configured"
    parsed = urlparse(url)
    port = parsed.port or 5672
    if not parsed.hostname:
        raise RuntimeError("invalid_endpoint")
    with socket.create_connection((parsed.hostname, port), timeout=2):
        return "up"


def build_probes(config: AppConfig):
    return [
        ("postgres", True, lambda: probe_postgres(config.database_url)),
        ("qdrant", False, lambda: probe_http(config.qdrant_url)),
        ("rabbitmq", False, lambda: probe_tcp(config.rabbit_url)),
    ]
