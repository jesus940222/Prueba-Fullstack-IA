import json

from fastapi.testclient import TestClient

from portal_ai.application.conversations import ChatService
from portal_ai.application.errors import AiError
from portal_ai.application.readiness import ReadinessService
from portal_ai.infrastructure.config import AppConfig
from portal_ai.infrastructure.graph.runner import RedactingSaver, build_graph, execute_graph
from portal_ai.infrastructure.tracing.langsmith import LangSmithExporter
from portal_ai.presentation.api import create_app
from portal_ai.application.provider_parse import parse_response
from portal_ai.domain.usage import UsageSample
from tests.test_phase6 import NOW, USER, engine, open_run, sample, turn

CONV = "77777777-7777-4777-8777-777777777777"


def config():
    return AppConfig("postgresql://ai:secret@postgres/ai", "", "", "", False, "", 3072, 3005)


def principal(token, permission):
    if token != "live":
        raise AiError("SESSION_INVALID", "La sesión no es válida")
    allowed = {"ai:chat:use", "ai:metrics:read:own", "ai:metrics:read:any", "ai:alerts:read", "ai:alerts:acknowledge", "ai:alerts:configure", "ai:documents:read", "ai:documents:reindex"}
    if permission not in allowed:
        raise AiError("PERMISSION_DENIED", "Sin permiso")
    return {"user_id": USER, "session_id": "sess", "deadline": "2026-10-21T18:01:00+00:00", "now": NOW}


def client_for(model_turns):
    result = engine(model_turns)
    service = ChatService(
        result.store,
        result,
        lambda: NOW,
        _ids(),
        {"rate_limit": 2, "rate_window": 60, "concurrency": 1, "model": "gpt-6-luna", "embedding_model": "text-embedding-3-large", "dimensions": 3072, "embed": None},
    )
    result.service = service
    app = create_app(ReadinessService("ai", []), config(), service, principal)
    return TestClient(app), result


def _ids():
    values = iter(["88888888-8888-4888-8888-888888888881", "88888888-8888-4888-8888-888888888882", "88888888-8888-4888-8888-888888888883", CONV])

    def new_id():
        return next(values)

    return new_id


def headers():
    return {"cookie": "portal_session=live; portal_csrf=csrf", "x-csrf-token": "csrf"}


def test_chat_dedupes_reconnects_and_hides_other_chats_from_admin_metrics():
    from tests.test_phase6 import ScriptedModel

    http, result = client_for(ScriptedModel([turn(text="Hola", request_id="h1")]))
    created = http.post("/api/v1/ai/conversations", headers=headers(), json={"title": "Saldo"})
    assert created.status_code == 201
    conversation_id = created.json()["id"]
    body = {"content": "Hola", "requestId": "99999999-9999-4999-8999-999999999999"}
    first = http.post(f"/api/v1/ai/conversations/{conversation_id}/messages", headers=headers(), json=body)
    second = http.post(f"/api/v1/ai/conversations/{conversation_id}/messages", headers=headers(), json=body)
    assert first.status_code == 202
    assert second.json()["runId"] == first.json()["runId"]
    assert result.model.calls == 1
    run_id = first.json()["runId"]
    stream = http.get(f"/api/v1/ai/runs/{run_id}/events", headers={"cookie": "portal_session=live"})
    again = http.get(f"/api/v1/ai/runs/{run_id}/events", headers={"cookie": "portal_session=live", "last-event-id": "1"})
    assert "event: content" in stream.text
    assert "token=" not in stream.text
    assert result.model.calls == 1
    assert "event: content" not in again.text or again.text != stream.text
    metrics = http.get("/api/v1/ai/admin/metrics", headers={"cookie": "portal_session=live"})
    assert "Hola" not in metrics.text
    denied = http.get("/api/v1/ai/admin/alerts", headers={"cookie": "portal_session=other"})
    assert denied.status_code == 401
    missing = http.post("/api/v1/ai/conversations", headers={"cookie": "portal_session=live"}, json={})
    assert missing.status_code == 403


def test_graph_resume_prepares_once_and_checkpoints_drop_secrets():
    from tests.test_phase6 import ScriptedModel

    result = engine(
        ScriptedModel(
            [
                turn(
                    tool="prepare_transfer",
                    arguments={
                        "sourceAccountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                        "beneficiaryId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                        "amount": "10.00",
                        "currency": "MXN",
                        "concept": "Prueba",
                    },
                    request_id="g1",
                )
            ]
        )
    )
    run_id = open_run(result, "Transfiere 10 pesos")
    saver = RedactingSaver()
    execute_graph(build_graph(result, saver), run_id)
    assert len(result.accounts.posts) == 1
    execute_graph(build_graph(result, saver), run_id)
    assert len(result.accounts.posts) == 1
    saver.put({"configurable": {"thread_id": "x", "checkpoint_ns": ""}}, {"channel_values": {"token": "sk-secret", "run_id": run_id}, "v": 1, "id": "cp", "ts": NOW, "channel_versions": {}, "versions_seen": {}}, {}, {})
    assert "sk-secret" not in json.dumps(saver.audited)


def test_langsmith_off_down_and_redacted():
    calls = []

    class Client:
        def create_run(self, payload):
            calls.append(payload)
            raise RuntimeError("down")

    quiet = LangSmithExporter(False, Client())
    quiet.export({"metadata": {"token": "sk-secret"}, "extra": {"password": "x"}})
    assert calls == []
    noisy = LangSmithExporter(True, Client())
    noisy.export({"metadata": {"run_id": "1", "model": "gpt-6-luna", "token": "sk-secret"}, "extra": {"nested": {"api_key": "sk-secret"}}})
    assert calls
    assert "sk-secret" not in json.dumps(calls)
    assert calls[0]["inputs"] == {}
    assert calls[0]["outputs"] == {}


def test_provider_parse_drops_reasoning_and_unknown_usage():
    parsed = parse_response(
        {
            "id": "resp-1",
            "output": [
                {"type": "reasoning", "content": "cadena interna"},
                {"type": "message", "content": [{"type": "output_text", "text": "Hola"}]},
            ],
            "usage": {"input_tokens": 10, "output_tokens": 2, "input_tokens_details": {"cached_tokens": 1}},
        },
        "gpt-6-luna",
        20,
    )
    assert parsed["text"] == "Hola"
    assert "cadena" not in json.dumps(parsed["usage"].__dict__)
    unknown = parse_response({"id": "resp-2", "output": [], "usage": {"input_tokens": 1, "mystery_tokens": 4}}, "gpt-6-luna", 1)
    assert unknown["usage"].complete is False
    assert unknown["usage"].input_tokens is None


def test_indexing_cost_is_separate_and_deleted_documents_are_not_indexed():
    from portal_ai.application.indexing import index_document
    from portal_ai.application.memory import MemoryStore
    from tests.test_phase6 import PRICES

    store = MemoryStore()
    document = {"id": "doc", "version": 1, "audience": "general", "status": "active", "deleted_at": None, "body": "# Uso\n" + ("texto " * 200), "code": "uso", "content_hash": "x", "application": "portal"}
    calls = {"n": 0}

    def embed(text):
        calls["n"] += 1
        return [0.1] * 3072, UsageSample(f"emb-{calls['n']}", "text-embedding-3-large", "indexing", 3, 20, 0, 0, 0, True)

    job = index_document(store, document, embed, PRICES, lambda: "job-1", "text-embedding-3-large", 3072)
    assert job["status"] == "completed"
    assert job["estimated_cost_usd"] is not None
    store.samples.append({"run_id": "run", "sample": UsageSample("emb-1", "text-embedding-3-large", "indexing", 3, 20, 0, 0, 0, True)})
    from portal_ai.domain.usage import aggregate

    assert aggregate([item["sample"] for item in store.samples], None).complete is False
    document["deleted_at"] = NOW
    failed = index_document(store, document, embed, PRICES, lambda: "job-2", "text-embedding-3-large", 3072)
    assert failed["error_code"] == "document_inactive"
    assert calls["n"] == len([item for item in store.vectors])
