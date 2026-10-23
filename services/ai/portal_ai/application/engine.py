from dataclasses import dataclass

from portal_ai.application.context import current_run
from portal_ai.application.dispatch import INSUFFICIENT
from portal_ai.application.errors import ProviderError
from portal_ai.application.memory import MemoryStore
from portal_ai.domain.alerts import decide_alert
from portal_ai.domain.budget import format_micro, within_hard_cap
from portal_ai.domain.knowledge import untrusted_evidence
from portal_ai.domain.money import parse_decimal
from portal_ai.domain.pricing import PriceTable, estimate_cost
from portal_ai.domain.prompts import PROMPT_VERSION, SYSTEM_RULES
from portal_ai.domain.redaction import redact, safe_metadata
from portal_ai.domain.tools import TOOL_SPECS, canonical_arguments, known_tools, validate_arguments
from portal_ai.domain.transfer import is_textual_confirmation
from portal_ai.domain.usage import UsageSample, aggregate
from portal_ai.domain.windows import mexico_day_bounds


@dataclass
class ModelTurn:
    text: str | None
    tool_name: str | None
    arguments: dict | None
    usage: UsageSample | None
    model: str
    provider_request_id: str


class ConversationEngine:
    def __init__(self, store: MemoryStore, model, dispatcher, authorizer, directory, mailer, tracer, clock, new_id, prices: PriceTable, limits: dict, audiences_for):
        self.store = store
        self.model = model
        self.dispatcher = dispatcher
        self.authorizer = authorizer
        self.directory = directory
        self.mailer = mailer
        self.tracer = tracer
        self.clock = clock
        self.new_id = new_id
        self.prices = prices
        self.limits = limits
        self.audiences_for = audiences_for

    def step(self, run_id: str) -> str:
        run = self.store.runs[run_id]
        current_run.set(run_id)
        if run["status"] in {"completed", "failed", "cancelled"}:
            return "stop"
        now = self.clock()
        if run["cancel"]:
            return self._finish(run, "cancelled", None)
        if now >= run["deadline"]:
            return self._finish(run, "failed", "timeout")
        if run["phase"] == "card":
            return "pause"
        if run["steps"] >= self.limits["max_steps"]:
            return self._finish(run, "failed", "max_steps")
        session = self.store.sessions.get(run_id)
        if session is None:
            return self._finish(run, "failed", "session_unavailable")
        try:
            principal = self.authorizer(session["token"], "ai:chat:use")
        except Exception:
            return self._finish(run, "failed", "session_revoked")
        if principal["user_id"] != run["user_id"] or not principal["active"]:
            return self._finish(run, "failed", "session_revoked")
        try:
            documents = self.authorizer(session["token"], "ai:documents:read")
            principal["administrative"] = documents["active"] and documents["user_id"] == run["user_id"]
        except Exception:
            principal["administrative"] = False
        if not self._reserve(run):
            return self._finish(run, "failed", "budget_exceeded")
        if run["steps"] == 0 and is_textual_confirmation(run["user_text"]) and self._pending_proposal(run["conversation_id"]):
            self._event(run, "content", "La confirmación se hace con el botón de la tarjeta. Un mensaje no mueve dinero.")
            return self._finish(run, "completed", None, "La confirmación se hace con el botón de la tarjeta. Un mensaje no mueve dinero.")
        turn = self._call_model(run, principal)
        if turn is None:
            return "stop"
        if self._tokens(run) > self.limits["max_total_tokens"]:
            return self._finish(run, "failed", "token_limit")
        if turn.tool_name is None:
            text = turn.text or ""
            sources = self._sources_if_needed(run, text)
            self._event(run, "content", text)
            if sources is not None:
                self._event(run, "tool_status", sources)
            return self._finish(run, "completed", None, text)
        try:
            arguments = validate_arguments(turn.tool_name, turn.arguments or {})
        except ValueError:
            self._event(run, "content", "Necesito datos más precisos para continuar, sin ejecutar nada.")
            return self._finish(run, "completed", None, "Necesito datos más precisos para continuar, sin ejecutar nada.")
        spec = TOOL_SPECS[turn.tool_name]
        try:
            allowed = self.authorizer(session["token"], spec.permission)
        except Exception:
            allowed = {"active": False, "user_id": ""}
        if not allowed["active"] or allowed["user_id"] != run["user_id"]:
            self._event(run, "tool_status", turn.tool_name)
            self._event(run, "content", "No tienes permiso para esa consulta.")
            return self._finish(run, "completed", None, "No tienes permiso para esa consulta.")
        self._event(run, "tool_status", turn.tool_name)
        if spec.mutating:
            result = self._mutate(run, turn.tool_name, arguments, session, principal)
        else:
            result = self.dispatcher.execute(turn.tool_name, arguments, session, self.audiences_for(principal), None)
        run["steps"] += 1
        run["last_tool"] = {"name": turn.tool_name, "result": redact(result)}
        if turn.tool_name == "search_documentation" and not result.get("sufficient"):
            self._event(run, "content", INSUFFICIENT)
            return self._finish(run, "completed", None, INSUFFICIENT)
        if turn.tool_name == "prepare_transfer" and "card" in result:
            run["phase"] = "card"
            run["proposal_id"] = result["card"]["proposalId"]
            self._event(run, "confirmation_required", result["card"]["proposalId"])
            return "pause"
        if turn.tool_name == "prepare_transfer":
            self._event(run, "content", "No pude preparar la transferencia. No se movió dinero.")
            return self._finish(run, "completed", None, "No pude preparar la transferencia. No se movió dinero.")
        return "continue"

    def finish_card(self, run_id: str) -> None:
        run = self.store.runs[run_id]
        if run["phase"] != "card" or run["status"] != "running":
            return
        session = self.store.sessions.get(run_id)
        active = False
        if session is not None:
            try:
                principal = self.authorizer(session["token"], "transfers:create:own")
                active = principal["active"] and principal["user_id"] == run["user_id"]
            except Exception:
                active = False
        if active:
            text = "Preparé la transferencia con los datos de Cuentas. Confírmala con el botón. Un sí en el chat no la ejecuta."
        else:
            text = "La sesión ya no permite usar esta propuesta. No se movió dinero."
        self._event(run, "content", text)
        self._finish(run, "completed", None, text)

    def _mutate(self, run: dict, name: str, arguments: dict, session: dict, principal: dict) -> dict:
        key = f"{run['id']}:{name}:{canonical_arguments(arguments)}"
        with self.store.lock:
            current = self.store.effects.get(key)
            if current is not None:
                return current
            self.store.effects[key] = {"pending": True}
        result = self.dispatcher.execute(name, arguments, session, self.audiences_for(principal), key)
        with self.store.lock:
            self.store.effects[key] = result
        return result

    def _call_model(self, run: dict, principal: dict) -> ModelTurn | None:
        tools = [spec for spec in known_tools() if self._permitted(run, spec.permission)]
        evidence = ""
        if run["last_tool"] and run["last_tool"]["name"] == "search_documentation":
            evidence = untrusted_evidence([]) if not run["last_tool"]["result"].get("chunks") else "usa solo las fuentes ya filtradas"
        request = {
            "instructions": SYSTEM_RULES,
            "prompt_version": PROMPT_VERSION,
            "user_id": principal["user_id"],
            "tools": [spec.name for spec in tools],
            "evidence": evidence,
            "messages": self._history(run),
        }
        attempt = 0
        while attempt < 2:
            attempt += 1
            try:
                turn = self.model.complete(request)
                self._record_usage(run, turn.usage, turn.provider_request_id, turn.model, turn.usage.latency_ms if turn.usage else 0)
                self.tracer.export({"metadata": safe_metadata({"run_id": run["id"], "model": turn.model, "status": run["status"], "step": run["steps"], "service": "ai", "prompt_version": PROMPT_VERSION, "pricing_version": self.prices.version, "tool_name": turn.tool_name or ""}), "input": request, "output": turn.text, "token": "sk-secret"})
                if turn.usage and turn.usage.complete and run["time_to_first_content_ms"] is None and turn.text:
                    run["time_to_first_content_ms"] = turn.usage.latency_ms
                return turn
            except ProviderError as error:
                self._record_usage(run, error.sample, f"{run['id']}-provider-{attempt}", run["model"], 0)
                self.tracer.export({"metadata": safe_metadata({"run_id": run["id"], "model": run["model"], "status": "failed", "service": "ai", "prompt_version": PROMPT_VERSION, "pricing_version": self.prices.version}), "error": "secret=sk-secret"})
                if error.code == "rate_limited" or attempt == 2 or run["phase"] == "card":
                    self._finish(run, "failed", error.code)
                    return None
        return None

    def _permitted(self, run: dict, permission: str) -> bool:
        session = self.store.sessions.get(run["id"])
        if session is None:
            return False
        try:
            allowed = self.authorizer(session["token"], permission)
        except Exception:
            return False
        return allowed["active"] and allowed["user_id"] == run["user_id"]

    def _history(self, run: dict) -> list[dict]:
        history = []
        for message in self.store.messages:
            if message["conversation_id"] == run["conversation_id"] and message["deleted_at"] is None:
                history.append({"role": message["role"], "content": message["content"]})
        observation = _tool_observation(run.get("last_tool"))
        if observation is not None:
            history.append({"role": "tool", "content": observation})
        return history

    def _sources_if_needed(self, run: dict, text: str) -> str | None:
        if not run["last_tool"] or run["last_tool"]["name"] != "search_documentation":
            return None
        sources = run["last_tool"]["result"].get("sources") or []
        if not sources:
            return None
        rendered = ", ".join(f"{item['documentId']} v{item['version']}" for item in sources)
        if rendered not in text:
            run["source_note"] = rendered
        return rendered

    def _record_usage(self, run: dict, sample: UsageSample | None, request_id: str, model: str, latency: int) -> None:
        if sample is None:
            sample = UsageSample(request_id, model, "chat", latency, None, None, None, None, False)
        self.store.samples.append({"run_id": run["id"], "sample": sample})

    def _tokens(self, run: dict) -> int:
        total = 0
        for item in self.store.samples:
            if item["run_id"] != run["id"] or not item["sample"].complete:
                continue
            total += (item["sample"].input_tokens or 0) + (item["sample"].output_tokens or 0)
        return total

    def _reserve(self, run: dict) -> bool:
        estimate = self.limits["reserve_micro"]
        now = self.clock()
        start, _end = mexico_day_bounds(now)
        with self.store.lock:
            if not within_hard_cap(self._spent(run["user_id"], run["id"], start, "run"), self._reserved(run["user_id"], run["id"], "run"), estimate, self.limits["run_cap"]):
                return False
            if not within_hard_cap(self._spent(run["user_id"], None, start, "user"), self._reserved(run["user_id"], None, "user"), estimate, self.limits["user_cap"]):
                return False
            if not within_hard_cap(self._spent(None, None, start, "global"), self._reserved(None, None, "global"), estimate, self.limits["global_cap"]):
                return False
            self.store.reservations.append({"run_id": run["id"], "user_id": run["user_id"], "micro": estimate, "at": now, "open": True})
        return True

    def _spent(self, user_id: str | None, run_id: str | None, start: str, scope: str) -> int:
        total = 0
        for item in self.store.spent:
            if item["at"] < start and scope != "run":
                continue
            if scope == "run" and item["run_id"] != run_id:
                continue
            if scope == "user" and item["user_id"] != user_id:
                continue
            total += item["micro"]
        return total

    def _reserved(self, user_id: str | None, run_id: str | None, scope: str) -> int:
        total = 0
        for item in self.store.reservations:
            if not item["open"]:
                continue
            if scope == "run" and item["run_id"] != run_id:
                continue
            if scope == "user" and item["user_id"] != user_id:
                continue
            total += item["micro"]
        return total

    def _finish(self, run: dict, status: str, error: str | None, text: str | None = None) -> str:
        if run["status"] in {"completed", "failed", "cancelled"}:
            return "stop"
        samples = [item["sample"] for item in self.store.samples if item["run_id"] == run["id"]]
        total = aggregate(samples, run["time_to_first_content_ms"])
        cost = estimate_cost(total, self.prices, "chat")
        run["status"] = status
        run["error_code"] = error
        run["finished_at"] = self.clock()
        run["usage_complete"] = total.complete
        run["estimated_cost_usd"] = cost
        run["latency_ms"] = total.latency_ms
        run["input_tokens"] = total.input_tokens
        run["output_tokens"] = total.output_tokens
        run["cached_tokens"] = total.cached_tokens
        run["total_tokens"] = total.total_tokens
        if text:
            self.store.messages.append(
                {
                    "id": self.new_id(),
                    "conversation_id": run["conversation_id"],
                    "role": "assistant",
                    "content": text if not run.get("source_note") else f"{text}\nFuentes: {run['source_note']}",
                    "created_at": run["finished_at"],
                    "deleted_at": None,
                    "run_id": run["id"],
                }
            )
        if cost is not None:
            with self.store.lock:
                for item in self.store.reservations:
                    if item["run_id"] == run["id"] and item["open"]:
                        item["open"] = False
                self.store.spent.append({"run_id": run["id"], "user_id": run["user_id"], "micro": parse_decimal(cost), "at": run["finished_at"]})
        self._event(run, "metrics", run["id"])
        self._event(run, "completed" if status == "completed" else "failed", error or status)
        self._outbox(run, status)
        self._alerts(run, cost)
        self.store.sessions.pop(run["id"], None)
        return "stop"

    def _event(self, run: dict, kind: str, text: str) -> None:
        event = {"type": kind}
        if kind == "confirmation_required":
            event["proposalId"] = text
        elif text:
            event["text"] = text
        self.store.add_event(run["id"], event)

    def _outbox(self, run: dict, status: str) -> None:
        event_type = {"completed": "ai.run.completed", "failed": "ai.run.failed", "cancelled": "ai.run.cancelled"}[status]
        key = f"outbox:{run['id']}:{event_type}"
        envelope = {
            "event_id": self.new_id(),
            "event_type": event_type,
            "schema_version": 1,
            "occurred_at": run["finished_at"],
            "source_service": "ai",
            "actor_type": "user",
            "actor_id": run["user_id"],
            "correlation_id": run["correlation_id"],
            "causation_id": None,
            "payload": {
                "run_id": run["id"],
                "conversation_id": run["conversation_id"],
                "model": run["model"],
                "status": status,
                "usage_complete": run["usage_complete"],
                "estimated_cost_usd": run["estimated_cost_usd"],
            },
        }
        self.store.once(key, envelope)
        if envelope not in self.store.outbox:
            self.store.outbox.append(self.store.effects[key])

    def _alerts(self, run: dict, cost: str | None) -> None:
        if cost is None:
            return
        now = run["finished_at"]
        start, end = mexico_day_bounds(now)
        observed = {
            "run": (cost, run["id"]),
            "user_day": (self._scope_cost(run["user_id"], start), run["user_id"]),
            "global_day": (self._scope_cost(None, start), "global"),
        }
        for rule in list(self.store.rules.values()):
            amount, scope_id = observed[rule["scope"]]
            if amount is None:
                continue
            same = any(
                alert["rule_id"] == rule["id"] and alert["window_start"] == (now if rule["window"] == "run" else start) and alert["scope_id"] == scope_id
                for alert in self.store.alerts
            )
            previous = [alert["created_at"] for alert in self.store.alerts if alert["rule_id"] == rule["id"] and alert["scope_id"] == scope_id]
            decision = decide_alert(rule["enabled"], amount, rule["threshold"], same, max(previous) if previous else None, now, rule["cooldown"])
            if not decision.emit:
                continue
            alert = {
                "id": self.new_id(),
                "rule_id": rule["id"],
                "scope": rule["scope"],
                "scope_id": scope_id,
                "user_id": run["user_id"] if rule["scope"] != "global_day" else None,
                "observed": amount,
                "status": "open",
                "window_start": now if rule["window"] == "run" else start,
                "window_end": now if rule["window"] == "run" else end,
                "created_at": now,
                "acknowledged_by": None,
            }
            self.store.alerts.append(alert)
            self.store.outbox.append(self._alert_event(alert, run))
            self._notify(alert, rule, run)

    def _scope_cost(self, user_id: str | None, start: str) -> str | None:
        values = []
        for item in self.store.runs.values():
            if item["finished_at"] is None or item["finished_at"] < start:
                continue
            if user_id is not None and item["user_id"] != user_id:
                continue
            if item["estimated_cost_usd"] is None:
                return None
            values.append(item["estimated_cost_usd"])
        if not values:
            return None
        return format_micro(sum(parse_decimal(value) for value in values))

    def _alert_event(self, alert: dict, run: dict) -> dict:
        return {
            "event_id": self.new_id(),
            "event_type": "ai.cost_alert.created",
            "schema_version": 1,
            "occurred_at": alert["created_at"],
            "source_service": "ai",
            "actor_type": "user",
            "actor_id": run["user_id"],
            "correlation_id": run["correlation_id"],
            "causation_id": None,
            "payload": {
                "alert_id": alert["id"],
                "rule_id": alert["rule_id"],
                "scope": alert["scope"],
                "observed_value_usd": alert["observed"],
            },
        }

    def _notify(self, alert: dict, rule: dict, run: dict) -> None:
        requested = list(rule["recipients"])
        resolved = self.directory(requested)
        allowed = {item["user_id"]: item["email"] for item in resolved}
        for recipient in requested or list(allowed):
            email = allowed.get(recipient)
            if email is None:
                continue
            delivery = {"id": self.new_id(), "alert_id": alert["id"], "channel": "email", "recipient": recipient, "status": "pending", "attempts": 1}
            try:
                self.mailer(email, "Alerta de coste del asistente", f"Alerta {alert['id']} por {alert['observed']} USD")
                delivery["status"] = "delivered"
            except Exception:
                delivery["status"] = "failed"
                self.store.outbox.append(
                    {
                        "event_id": self.new_id(),
                        "event_type": "notification.delivery.failed",
                        "schema_version": 1,
                        "occurred_at": self.clock(),
                        "source_service": "ai",
                        "actor_type": "service",
                        "actor_id": run["user_id"],
                        "correlation_id": run["correlation_id"],
                        "causation_id": None,
                        "payload": {"delivery_id": delivery["id"], "alert_id": alert["id"], "channel": "email", "error_code": "delivery_failed"},
                    }
                )
            self.store.deliveries.append(delivery)
        self.store.deliveries.append({"id": self.new_id(), "alert_id": alert["id"], "channel": "ui", "recipient": None, "status": "delivered", "attempts": 1})

    def _pending_proposal(self, conversation_id: str) -> bool:
        return any(item["conversation_id"] == conversation_id and item.get("proposal_id") for item in self.store.runs.values())


def _tool_observation(tool: dict | None) -> str | None:
    if tool is None:
        return None
    result = tool["result"]
    lines = [tool["name"]]
    if result.get("error"):
        lines.append(str(result["error"]))
    for source in result.get("sources") or []:
        lines.append(f"{source.get('documentId')} v{source.get('version')}")
    for chunk in (result.get("chunks") or [])[:4]:
        lines.append(f"{chunk.get('section', '')}: {str(chunk.get('text', ''))[:500]}")
    if result.get("data") is not None:
        lines.append(str(result["data"])[:1500])
    return "\n".join(lines)[:4000]
