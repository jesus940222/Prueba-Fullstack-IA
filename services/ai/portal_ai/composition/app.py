import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import request as urlrequest
from uuid import uuid4

from portal_ai.application.conversations import ChatService, register_document
from portal_ai.application.dispatch import ToolDispatcher
from portal_ai.application.engine import ConversationEngine
from portal_ai.application.errors import AiError
from portal_ai.application.indexing import authoritative_documents
from portal_ai.application.memory import MemoryStore
from portal_ai.application.readiness import ReadinessService
from portal_ai.domain.knowledge import RetrievedChunk
from portal_ai.domain.money import parse_decimal
from portal_ai.domain.pricing import PriceTable
from portal_ai.infrastructure.clients import build_probes
from portal_ai.infrastructure.config import load_config
from portal_ai.infrastructure.graph.runner import RedactingSaver, build_graph, execute_graph
from portal_ai.infrastructure.openai_api import OpenAIModel
from portal_ai.infrastructure.persistence.state import load_state, save_state
from portal_ai.infrastructure.service_token import service_token
from portal_ai.infrastructure.session_client import SessionClient
from portal_ai.infrastructure.tracing.langsmith import LangSmithExporter
from portal_ai.presentation.api import create_app

config = load_config()
store = MemoryStore()
load_state(config.database_url, store)
prices = PriceTable.from_rates(
    os.environ.get("OPENAI_PRICE_OBSERVED_ON", "2026-10-21"),
    os.environ.get("OPENAI_PRICE_INPUT_PER_MILLION", "0.10"),
    os.environ.get("OPENAI_PRICE_CACHED_INPUT_PER_MILLION", "0.01"),
    os.environ.get("OPENAI_PRICE_CACHE_WRITE_PER_MILLION", "0.125"),
    os.environ.get("OPENAI_PRICE_OUTPUT_PER_MILLION", "0.50"),
    os.environ.get("OPENAI_PRICE_EMBEDDING_PER_MILLION", "0.13"),
)
model = OpenAIModel(config.openai_api_key, os.environ.get("OPENAI_CONVERSATION_MODEL", "gpt-6-luna"))
accounts = SessionClient(os.environ.get("ACCOUNTS_BASE_URL", "http://accounts:3002"))
catalog = SessionClient(os.environ.get("CATALOG_BASE_URL", "http://catalog:3003"))
access_url = os.environ.get("ACCESS_AUTHORIZE_URL", "http://access:3001").rstrip("/")
service_secret = os.environ.get("AI_SERVICE_SECRET", "")


class Retriever:
    def search(self, query: str):
        if not config.qdrant_url or not config.openai_api_key:
            return []
        try:
            from portal_ai.application.context import current_run
            from qdrant_client import QdrantClient
            from qdrant_client.http.models import FieldCondition, Filter, MatchValue

            vector, sample = model.embed(query, config.vector_size, "retrieval")
            run_id = current_run.get()
            if run_id:
                store.samples.append({"run_id": run_id, "sample": sample})
            client = QdrantClient(url=config.qdrant_url, timeout=5)
            found = client.query_points(
                collection_name=os.environ.get("QDRANT_COLLECTION", "knowledge"),
                query=vector,
                limit=4,
                query_filter=Filter(
                    must=[
                        FieldCondition(key="application", match=MatchValue(value="portal")),
                        FieldCondition(key="active", match=MatchValue(value=True)),
                        FieldCondition(key="deleted", match=MatchValue(value=False)),
                    ]
                ),
            )
            hits = []
            for point in found.points:
                payload = point.payload or {}
                hits.append(
                    RetrievedChunk(
                        str(payload.get("document_id", "")),
                        int(payload.get("version", 0)),
                        int(payload.get("chunk_index", 0)),
                        str(payload.get("section", "general")),
                        str(payload.get("text", "")),
                        str(payload.get("audience", "general")),
                        str(payload.get("application", "portal")),
                    )
                )
            return hits
        except Exception:
            return []


def authorizer(token: str, permission: str) -> dict:
    if len(service_secret) < 32:
        raise AiError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión")
    call = urlrequest.Request(
        f"{access_url}/internal/v1/access/authorize",
        data=json.dumps({"sessionToken": token, "applicationCode": "portal", "permission": permission}).encode(),
        headers={"authorization": f"Bearer {service_token(service_secret, 'ai', 'access.authorize')}", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(call, timeout=5) as response:
            payload = json.load(response)
            status = response.status
    except Exception as error:
        status = getattr(error, "code", 503)
        payload = {}
    if status == 401:
        raise RuntimeError("revoked")
    if status != 200:
        raise AiError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión")
    principal = payload.get("principal") or {}
    return {
        "user_id": principal.get("userId", ""),
        "session_id": principal.get("sessionId", ""),
        "active": payload.get("decision") == "allow",
    }


def directory(user_ids: list[str]) -> list[dict]:
    if len(service_secret) < 32:
        return []
    call = urlrequest.Request(
        f"{access_url}/internal/v1/access/alert-recipients",
        data=json.dumps({"userIds": user_ids} if user_ids else {}).encode(),
        headers={"authorization": f"Bearer {service_token(service_secret, 'ai', 'access.alert-recipients')}", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(call, timeout=5) as response:
            payload = json.load(response)
    except Exception:
        return []
    return payload.get("recipients") or []


def mailer(email: str, subject: str, text: str) -> None:
    import smtplib
    from email.message import EmailMessage
    from urllib.parse import urlparse

    parsed = urlparse(os.environ.get("SMTP_URL", "smtp://mailpit:1025"))
    message = EmailMessage()
    message["From"] = "alertas@portal.local"
    message["To"] = email
    message["Subject"] = subject
    message.set_content(text)
    with smtplib.SMTP(parsed.hostname or "mailpit", parsed.port or 1025, timeout=5) as smtp:
        smtp.send_message(message)


tracer = LangSmithExporter(
    config.langsmith_tracing and bool(config.langsmith_api_key.strip()),
    None,
)
if config.langsmith_tracing and config.langsmith_api_key.strip():
    try:
        from langsmith import Client

        tracer.client = Client(
            api_key=config.langsmith_api_key,
            api_url=os.environ.get("LANGSMITH_ENDPOINT") or None,
            hide_inputs=True,
            hide_outputs=True,
        )
    except Exception:
        tracer.enabled = False

engine = ConversationEngine(
    store,
    model,
    ToolDispatcher(accounts, catalog, Retriever(), lambda: authoritative_documents(store)),
    authorizer,
    directory,
    mailer,
    tracer,
    lambda: datetime.now(timezone.utc).isoformat(),
    lambda: str(uuid4()),
    prices,
    {
        "max_steps": int(os.environ.get("AI_MAX_STEPS", "8")),
        "max_total_tokens": int(os.environ.get("AI_MAX_TOTAL_TOKENS", "8000")),
        "reserve_micro": parse_decimal(os.environ.get("AI_BUDGET_RESERVE_USD", "0.05")),
        "run_cap": parse_decimal(os.environ.get("AI_BUDGET_RUN_USD", "1.00")),
        "user_cap": parse_decimal(os.environ.get("AI_BUDGET_USER_DAY_USD", "5.00")),
        "global_cap": parse_decimal(os.environ.get("AI_BUDGET_GLOBAL_DAY_USD", "25.00")),
    },
    lambda principal: {"general", "administrative"} if principal.get("administrative") else {"general"},
)
graph = build_graph(engine, RedactingSaver())


def runner(run_id: str) -> None:
    execute_graph(graph, run_id)
    save_state(config.database_url, store)


service = ChatService(
    store,
    engine,
    lambda: datetime.now(timezone.utc).isoformat(),
    lambda: str(uuid4()),
    {
        "rate_limit": int(os.environ.get("AI_CHAT_RATE_LIMIT", "20")),
        "rate_window": int(os.environ.get("AI_CHAT_RATE_WINDOW", "60")),
        "concurrency": int(os.environ.get("AI_MAX_CONCURRENCY", "2")),
        "model": os.environ.get("OPENAI_CONVERSATION_MODEL", "gpt-6-luna"),
        "embedding_model": "text-embedding-3-large",
        "dimensions": config.vector_size,
        "embed": (lambda text: model.embed(text, config.vector_size, "indexing")) if config.openai_api_key.strip() else None,
    },
    runner,
)


def http_authorize(token: str, permission: str) -> dict:
    try:
        result = authorizer(token, permission)
    except RuntimeError as error:
        if str(error) == "revoked":
            raise AiError("SESSION_INVALID", "La sesión no es válida") from error
        raise
    except AiError:
        raise
    if not result["active"]:
        raise AiError("PERMISSION_DENIED", "No tienes permiso para esta operación")
    now = datetime.now(timezone.utc)
    result["now"] = now.isoformat()
    result["deadline"] = (now + timedelta(seconds=int(os.environ.get("AI_RUN_TIMEOUT", "60")))).isoformat()
    return result


def publish_vectors(document_id: str, vectors: list[dict]) -> None:
    from qdrant_client import QdrantClient

    from portal_ai.infrastructure.qdrant.index import replace_document

    client = QdrantClient(url=config.qdrant_url, timeout=5)
    replace_document(client, os.environ.get("QDRANT_COLLECTION", "knowledge"), document_id, vectors)


service.limits["publish_vectors"] = publish_vectors if config.qdrant_url else None


def seed_alert_rules() -> None:
    if store.rules:
        return
    from uuid import UUID
    from uuid import uuid5

    namespace = UUID("6f0b9c2e-7a31-4d5e-9c11-2b8e4a6d0f73")
    cooldown = int(os.environ.get("AI_ALERT_COOLDOWN", "1800"))
    for scope, threshold, window in (
        ("run", "0.80", "run"),
        ("run", "1.00", "run"),
        ("user_day", "4.00", "user_day"),
        ("user_day", "5.00", "user_day"),
        ("global_day", "20.00", "global_day"),
        ("global_day", "25.00", "global_day"),
    ):
        rule_id = str(uuid5(namespace, f"alert:{scope}:{threshold}"))
        store.rules[rule_id] = {
            "id": rule_id,
            "scope": scope,
            "metric": "estimated_cost_usd",
            "threshold": threshold,
            "window": window,
            "cooldown": cooldown,
            "enabled": True,
            "version": 1,
            "recipients": [],
        }
    store.effects["rules-version"] = {"version": 1}


def register_knowledge() -> None:
    directory_path = Path(os.environ.get("KNOWLEDGE_DIR", "/app/knowledge"))
    if not directory_path.is_dir():
        return
    for path in sorted(directory_path.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        header, _, body = text.partition("\n---\n")
        fields = {}
        for line in header.removeprefix("---\n").splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                fields[key.strip()] = value.strip()
        register_document(store, lambda: str(uuid4()), fields["code"], fields["title"], fields["audience"], body or text)
    save_state(config.database_url, store)


def index_registered() -> None:
    if service.limits.get("embed") is None or not config.qdrant_url:
        return
    for document in list(store.documents.values()):
        if document["deleted_at"] is not None or document["status"] != "active":
            continue
        already = any(
            job["document_id"] == document["id"] and job["status"] == "completed" and job.get("content_hash") == document["content_hash"]
            for job in store.jobs.values()
        )
        if already:
            continue
        try:
            service.reindex(document["id"])
        except Exception:
            continue


seed_alert_rules()
register_knowledge()
index_registered()
save_state(config.database_url, store)


def publish_forever() -> None:
    from portal_ai.infrastructure.messaging.outbox import publish_pending

    while True:
        time.sleep(5)
        pending = [event for event in store.outbox if not event.get("published_at")]
        if not pending or not config.rabbit_url:
            continue
        try:
            publish_pending(config.rabbit_url, pending)
        except Exception:
            continue
        stamp = datetime.now(timezone.utc).isoformat()
        for event in pending:
            event["published_at"] = stamp
        try:
            save_state(config.database_url, store)
        except Exception:
            continue


threading.Thread(target=publish_forever, name="ai-outbox", daemon=True).start()
app = create_app(ReadinessService("ai", build_probes(config)), config, service, http_authorize)
