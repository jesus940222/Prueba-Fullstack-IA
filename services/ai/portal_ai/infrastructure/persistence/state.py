import json

from sqlalchemy import create_engine, text

from portal_ai.infrastructure.clients import sqlalchemy_url


def load_state(url: str, store) -> None:
    engine = create_engine(sqlalchemy_url(url), pool_pre_ping=True)
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT collection, record_id, document::text FROM ai_records")).all()
    messages = []
    events: dict = {}
    for collection, record_id, document in rows:
        payload = json.loads(document)
        if collection == "messages":
            messages.append(payload)
        elif collection == "events":
            events.setdefault(payload["run_id"], []).append(payload["event"])
        elif collection in {"conversations", "runs", "documents", "jobs", "rules"}:
            getattr(store, collection)[record_id] = payload
        elif collection in {"alerts", "deliveries", "outbox", "vectors"}:
            getattr(store, collection).append(payload)
    store.messages = messages
    store.events = events
    for run in store.runs.values():
        if run["status"] == "running":
            run["status"] = "failed"
            run["error_code"] = "session_unavailable"
    engine.dispose()


def save_state(url: str, store) -> None:
    engine = create_engine(sqlalchemy_url(url), pool_pre_ping=True)
    records = list(_items(store))
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM ai_records"))
        for collection, record_id, document in records:
            connection.execute(
                text("INSERT INTO ai_records (collection, record_id, document) VALUES (:collection, :record_id, CAST(:document AS jsonb))"),
                {"collection": collection, "record_id": record_id, "document": document},
            )
    engine.dispose()


def _items(store):
    for key, value in store.conversations.items():
        yield "conversations", key, _json(value)
    for message in store.messages:
        yield "messages", message["id"], _json(message)
    for key, value in store.runs.items():
        visible = {name: item for name, item in value.items() if name != "last_tool"}
        yield "runs", key, _json(visible)
    for run_id, events in store.events.items():
        for event in events:
            yield "events", f"{run_id}:{event['id']}", _json({"run_id": run_id, "event": event})
    for key, value in store.documents.items():
        yield "documents", key, _json(value)
    for key, value in store.jobs.items():
        yield "jobs", key, _json(value)
    for key, value in store.rules.items():
        yield "rules", key, _json(value)
    for alert in store.alerts:
        yield "alerts", alert["id"], _json(alert)
    for delivery in store.deliveries:
        yield "deliveries", delivery["id"], _json(delivery)
    for event in store.outbox:
        yield "outbox", event["event_id"], _json(event)


def _json(value: dict) -> str:
    encoded = json.dumps(value)
    if "portal_session=" in encoded or "sk-" in encoded or "Bearer " in encoded:
        raise RuntimeError("secret_in_state")
    return encoded
