from portal_ai.application.drive import drive
from portal_ai.application.errors import AiError
from portal_ai.domain.knowledge import content_hash, validate_document
from portal_ai.domain.money import format_decimal, parse_decimal
from portal_ai.domain.prompts import PROMPT_VERSION
from portal_ai.domain.windows import allow_message, mexico_day_bounds


class ChatService:
    def __init__(self, store, engine, clock, new_id, limits, runner=None):
        self.store = store
        self.engine = engine
        self.clock = clock
        self.new_id = new_id
        self.limits = limits
        self.runner = runner or (lambda run_id: drive(engine, run_id))

    def create_conversation(self, user_id: str, title: str | None) -> dict:
        now = self.clock()
        conversation = {
            "id": self.new_id(),
            "user_id": user_id,
            "title": (title or "Conversación").strip()[:120] or "Conversación",
            "status": "active",
            "created_at": now,
            "deleted_at": None,
        }
        self.store.conversations[conversation["id"]] = conversation
        return _conversation(conversation)

    def list_conversations(self, user_id: str, page: int, page_size: int, sort: str) -> dict:
        items = [item for item in self.store.conversations.values() if item["user_id"] == user_id and item["deleted_at"] is None]
        reverse = sort != "createdAt"
        items.sort(key=lambda item: (item["created_at"], item["id"]), reverse=reverse)
        start = (page - 1) * page_size
        page_items = items[start : start + page_size]
        total = len(items)
        pages = (total + page_size - 1) // page_size if total else 0
        return {"items": [_conversation(item) for item in page_items], "totalItems": total, "totalPages": pages, "page": page, "pageSize": page_size}

    def get_conversation(self, user_id: str, conversation_id: str) -> dict:
        return _conversation(self._own(user_id, conversation_id))

    def rename(self, user_id: str, conversation_id: str, title: str) -> dict:
        conversation = self._own(user_id, conversation_id)
        conversation["title"] = title.strip()
        return _conversation(conversation)

    def delete(self, user_id: str, conversation_id: str) -> None:
        conversation = self._own(user_id, conversation_id)
        conversation["deleted_at"] = self.clock()
        conversation["status"] = "deleted"
        for message in self.store.messages:
            if message["conversation_id"] == conversation_id:
                message["deleted_at"] = conversation["deleted_at"]
        self.store.sessions = {
            key: value
            for key, value in self.store.sessions.items()
            if key not in self.store.runs or self.store.runs[key]["conversation_id"] != conversation_id
        }

    def list_messages(self, user_id: str, conversation_id: str, limit: int, cursor: str | None) -> dict:
        self._own(user_id, conversation_id)
        items = [item for item in self.store.messages if item["conversation_id"] == conversation_id and item["deleted_at"] is None]
        items.sort(key=lambda item: (item["created_at"], item["id"]))
        if cursor:
            ids = [item["id"] for item in items]
            if cursor not in ids:
                raise AiError("VALIDATION_ERROR", "El cursor no pertenece a esta conversación")
            items = items[ids.index(cursor) + 1 :]
        page = items[:limit]
        has_more = len(items) > limit
        return {"items": [_message(item) for item in page], "nextCursor": page[-1]["id"] if has_more else None, "hasMore": has_more}

    def post_message(self, user_id: str, conversation_id: str, content: str, request_id: str, session: dict) -> dict:
        self._own(user_id, conversation_id)
        for run in self.store.runs.values():
            if run.get("request_id") == request_id and run["conversation_id"] == conversation_id:
                return {"runId": run["id"], "conversationId": conversation_id}
        now = self.clock()
        stamps = self.store.rate_stamps.setdefault(user_id, [])
        if not allow_message(stamps, now, self.limits["rate_limit"], self.limits["rate_window"]):
            raise AiError("RATE_LIMITED", "Demasiados mensajes en la ventana")
        running = [run for run in self.store.runs.values() if run["user_id"] == user_id and run["status"] == "running"]
        if len(running) >= self.limits["concurrency"]:
            raise AiError("RATE_LIMITED", "Hay demasiadas ejecuciones abiertas")
        stamps.append(now)
        run_id = self.new_id()
        self.store.messages.append(
            {"id": self.new_id(), "conversation_id": conversation_id, "role": "user", "content": content, "created_at": now, "deleted_at": None, "run_id": run_id}
        )
        self.store.runs[run_id] = {
            "id": run_id,
            "conversation_id": conversation_id,
            "user_id": user_id,
            "session_id": session.get("session_id", ""),
            "status": "running",
            "phase": "run",
            "cancel": False,
            "deadline": session["deadline"],
            "steps": 0,
            "model": self.limits["model"],
            "user_text": content,
            "correlation_id": session["correlation_id"],
            "time_to_first_content_ms": None,
            "last_tool": None,
            "finished_at": None,
            "proposal_id": None,
            "source_note": None,
            "request_id": request_id,
            "prompt_version": PROMPT_VERSION,
            "pricing_version": self.engine.prices.version,
        }
        self.store.sessions[run_id] = {"token": session["token"], "csrf": session.get("csrf", "")}
        self.runner(run_id)
        return {"runId": run_id, "conversationId": conversation_id}

    def get_run(self, user_id: str, run_id: str, any_metrics: bool = False) -> dict:
        run = self._run(user_id, run_id, any_metrics)
        return _run(run)

    def events(self, user_id: str, run_id: str, after: int) -> list[dict]:
        self._run(user_id, run_id, False)
        return [event for event in self.store.events.get(run_id, []) if event["id"] > after]

    def cancel(self, user_id: str, run_id: str) -> dict:
        run = self._run(user_id, run_id, False)
        if run["status"] == "running":
            run["cancel"] = True
            run["cancellation_requested_at"] = self.clock()
            self.engine.step(run_id)
        return _run(run)

    def metrics(self, user_id: str | None, start: str, end: str) -> dict:
        runs = [run for run in self.store.runs.values() if run["finished_at"] and start <= run["finished_at"] < end and (user_id is None or run["user_id"] == user_id)]
        incomplete = any(not run["usage_complete"] for run in runs)
        cost = None if incomplete or not runs else format_decimal(sum(parse_decimal(run["estimated_cost_usd"]) for run in runs if run["estimated_cost_usd"]))
        if incomplete or not runs:
            tokens = {"inputTokens": None, "outputTokens": None, "cachedTokens": None, "totalTokens": None}
        else:
            tokens = {
                "inputTokens": sum(run["input_tokens"] or 0 for run in runs),
                "outputTokens": sum(run["output_tokens"] or 0 for run in runs),
                "cachedTokens": sum(run["cached_tokens"] or 0 for run in runs),
                "totalTokens": sum(run["total_tokens"] or 0 for run in runs),
            }
        return {"from": start, "to": end, "runCount": len(runs), "estimatedCostUsd": cost, "usageComplete": not incomplete and bool(runs), **tokens}

    def run_metrics(self, user_id: str, run_id: str, any_metrics: bool) -> dict:
        run = self._run(user_id, run_id, any_metrics)
        return {
            "runId": run["id"],
            "model": run["model"],
            "latencyMs": run.get("latency_ms"),
            "timeToFirstContentMs": run.get("time_to_first_content_ms"),
            "usageComplete": bool(run.get("usage_complete")),
            "estimatedCostUsd": run.get("estimated_cost_usd"),
            "pricingVersion": run.get("pricing_version"),
            "inputTokens": run.get("input_tokens"),
            "outputTokens": run.get("output_tokens"),
            "cachedTokens": run.get("cached_tokens"),
            "totalTokens": run.get("total_tokens"),
        }

    def alerts(self, page: int, page_size: int) -> dict:
        items = list(self.store.alerts)
        start = (page - 1) * page_size
        page_items = items[start : start + page_size]
        total = len(items)
        return {
            "items": [{"id": item["id"], "ruleId": item["rule_id"], "scope": item["scope"], "observedValueUsd": item["observed"], "status": item["status"]} for item in page_items],
            "totalItems": total,
            "totalPages": (total + page_size - 1) // page_size if total else 0,
            "page": page,
            "pageSize": page_size,
        }

    def acknowledge(self, alert_id: str, user_id: str, correlation_id: str) -> dict:
        alert = next((item for item in self.store.alerts if item["id"] == alert_id), None)
        if alert is None:
            raise AiError("RESOURCE_NOT_VISIBLE", "La alerta no está disponible")
        if alert["status"] == "open":
            alert["status"] = "acknowledged"
            alert["acknowledged_by"] = user_id
            self.store.outbox.append(
                {
                    "event_id": self.new_id(),
                    "event_type": "ai.cost_alert.acknowledged",
                    "schema_version": 1,
                    "occurred_at": self.clock(),
                    "source_service": "ai",
                    "actor_type": "user",
                    "actor_id": user_id,
                    "correlation_id": correlation_id,
                    "causation_id": None,
                    "payload": {"alert_id": alert_id},
                }
            )
        return {"id": alert["id"], "ruleId": alert["rule_id"], "scope": alert["scope"], "observedValueUsd": alert["observed"], "status": alert["status"]}

    def day_bounds(self, now: str) -> tuple[str, str]:
        return mexico_day_bounds(now)

    def list_rules(self, page: int, page_size: int) -> dict:
        items = list(self.store.rules.values())
        total = len(items)
        start = (page - 1) * page_size
        return {"items": [_rule(item) for item in items[start : start + page_size]], "totalItems": total, "totalPages": (total + page_size - 1) // page_size if total else 0, "page": page, "pageSize": page_size}

    def replace_rules(self, version: int, rules: list[dict]) -> dict:
        current = int(self.store.effects.get("rules-version", {"version": 0})["version"])
        if version != current + 1 and not (current == 0 and version == 1):
            if version != current:
                raise AiError("CONFLICT", "La versión de las reglas cambió")
        stored = {}
        for rule in rules:
            if rule.get("metric") != "estimated_cost_usd":
                raise AiError("VALIDATION_ERROR", "La métrica no está permitida")
            if any("@" in str(item) for item in rule.get("administrativeRecipientIds", [])):
                raise AiError("VALIDATION_ERROR", "La regla no acepta correos")
            stored[rule["id"]] = {
                "id": rule["id"],
                "scope": rule["scope"],
                "metric": "estimated_cost_usd",
                "threshold": rule["threshold"],
                "window": rule["window"],
                "cooldown": rule["cooldownSeconds"],
                "enabled": rule["enabled"],
                "version": version,
                "recipients": rule.get("administrativeRecipientIds", []),
            }
        self.store.rules = stored
        self.store.effects["rules-version"] = {"version": version}
        return self.list_rules(1, 100)

    def list_documents(self, page: int, page_size: int) -> dict:
        items = [item for item in self.store.documents.values() if item["deleted_at"] is None]
        total = len(items)
        start = (page - 1) * page_size
        return {"items": [_document(item) for item in items[start : start + page_size]], "totalItems": total, "totalPages": (total + page_size - 1) // page_size if total else 0, "page": page, "pageSize": page_size}

    def reindex(self, document_id: str) -> dict:
        document = self.store.documents.get(document_id)
        if document is None or document["deleted_at"] is not None:
            raise AiError("RESOURCE_NOT_VISIBLE", "El documento no está disponible")
        if self.limits.get("embed") is None:
            raise AiError("DEPENDENCY_UNAVAILABLE", "El modelo de embeddings no está configurado")
        from portal_ai.application.indexing import index_document

        job = index_document(self.store, document, self.limits["embed"], self.engine.prices, self.new_id, self.limits["embedding_model"], self.limits["dimensions"])
        publisher = self.limits.get("publish_vectors")
        if publisher is not None and job["status"] == "completed":
            try:
                publisher(document["id"], [item for item in self.store.vectors if item["payload"]["document_id"] == document["id"]])
            except Exception:
                job["status"] = "failed"
                job["error_code"] = "index_unavailable"
        return _job(job)

    def get_job(self, job_id: str) -> dict:
        job = self.store.jobs.get(job_id)
        if job is None:
            raise AiError("RESOURCE_NOT_VISIBLE", "El trabajo no está disponible")
        return _job(job)

    def _own(self, user_id: str, conversation_id: str) -> dict:
        conversation = self.store.conversations.get(conversation_id)
        if conversation is None or conversation["user_id"] != user_id or conversation["deleted_at"] is not None:
            raise AiError("RESOURCE_NOT_VISIBLE", "La conversación no está disponible")
        return conversation

    def _run(self, user_id: str, run_id: str, any_metrics: bool) -> dict:
        run = self.store.runs.get(run_id)
        if run is None or (run["user_id"] != user_id and not any_metrics):
            raise AiError("RESOURCE_NOT_VISIBLE", "La ejecución no está disponible")
        return run


def register_document(store, new_id, code: str, title: str, audience: str, text: str) -> dict:
    body = validate_document(text)
    digest = content_hash(body)
    current = next((item for item in store.documents.values() if item["code"] == code and item["deleted_at"] is None), None)
    if current and current["content_hash"] == digest and current["status"] == "active":
        return current
    version = 1 if current is None else current["version"] + 1
    if current:
        current["status"] = "disabled"
    document = {
        "id": current["id"] if current else new_id(),
        "code": code,
        "title": title,
        "version": version,
        "content_hash": digest,
        "audience": audience,
        "application": "portal",
        "status": "active",
        "deleted_at": None,
        "body": body,
    }
    store.documents[document["id"]] = document
    return document


def _conversation(item: dict) -> dict:
    return {"id": item["id"], "title": item["title"], "status": "deleted" if item["deleted_at"] else "active", "createdAt": item["created_at"]}


def _message(item: dict) -> dict:
    body = {"id": item["id"], "role": item["role"], "content": item["content"], "createdAt": item["created_at"]}
    if item.get("run_id") and item["role"] == "assistant":
        body["runId"] = item["run_id"]
    return body


def _rule(item: dict) -> dict:
    return {
        "id": item["id"],
        "scope": item["scope"],
        "metric": "estimated_cost_usd",
        "threshold": item["threshold"],
        "window": item["window"],
        "cooldownSeconds": item["cooldown"],
        "enabled": item["enabled"],
        "version": item["version"],
        "administrativeRecipientIds": item["recipients"],
    }


def _document(item: dict) -> dict:
    return {"id": item["id"], "code": item["code"], "title": item["title"], "version": item["version"], "contentHash": item["content_hash"], "audience": item["audience"], "status": "disabled" if item["status"] != "active" else "active"}


def _job(item: dict) -> dict:
    return {
        "id": item["id"],
        "documentId": item["document_id"],
        "embeddingModel": item["embedding_model"],
        "dimensions": item["dimensions"],
        "status": item["status"],
        "processedChunks": item["processed_chunks"],
        "errorCode": item["error_code"],
    }


def _run(item: dict) -> dict:
    return {
        "id": item["id"],
        "conversationId": item["conversation_id"],
        "status": item["status"] if item["status"] in {"queued", "running", "completed", "failed", "cancelled"} else "running",
        "model": item["model"],
        "usageComplete": bool(item.get("usage_complete")),
        "estimatedCostUsd": item.get("estimated_cost_usd"),
    }
