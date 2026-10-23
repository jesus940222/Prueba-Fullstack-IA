import json
from urllib.parse import urlencode

from fastapi import Body, Request
from fastapi.responses import StreamingResponse

from portal_ai.application.errors import AiError


def mount_chat(app, service, authorize):
    @app.post("/api/v1/ai/conversations", status_code=201)
    def create_conversation(request: Request, body: dict = Body(default_factory=dict)):
        principal = _principal(authorize, request, "ai:chat:use")
        title = body.get("title") if isinstance(body, dict) else None
        if title is not None and (not isinstance(title, str) or len(title) > 120):
            raise AiError("VALIDATION_ERROR", "El título no es válido")
        return service.create_conversation(principal["user_id"], title)

    @app.get("/api/v1/ai/conversations")
    def list_conversations(request: Request):
        principal = _principal(authorize, request, "ai:chat:use")
        page, page_size, sort = _page(request)
        return service.list_conversations(principal["user_id"], page, page_size, sort)

    @app.get("/api/v1/ai/conversations/{conversation_id}")
    def get_conversation(request: Request, conversation_id: str):
        principal = _principal(authorize, request, "ai:chat:use")
        _uuid(conversation_id)
        return service.get_conversation(principal["user_id"], conversation_id)

    @app.patch("/api/v1/ai/conversations/{conversation_id}")
    def rename_conversation(request: Request, conversation_id: str, body: dict = Body(...)):
        principal = _principal(authorize, request, "ai:chat:use")
        _uuid(conversation_id)
        title = body.get("title") if isinstance(body, dict) else None
        if not isinstance(title, str) or not title.strip() or len(title) > 120:
            raise AiError("VALIDATION_ERROR", "El título no es válido")
        return service.rename(principal["user_id"], conversation_id, title)

    @app.delete("/api/v1/ai/conversations/{conversation_id}", status_code=204)
    def delete_conversation(request: Request, conversation_id: str):
        principal = _principal(authorize, request, "ai:chat:use")
        _uuid(conversation_id)
        service.delete(principal["user_id"], conversation_id)

    @app.get("/api/v1/ai/conversations/{conversation_id}/messages")
    def list_messages(request: Request, conversation_id: str, limit: int = 20, cursor: str | None = None):
        principal = _principal(authorize, request, "ai:chat:use")
        _uuid(conversation_id)
        if limit < 1 or limit > 50:
            raise AiError("VALIDATION_ERROR", "El límite no es válido")
        return service.list_messages(principal["user_id"], conversation_id, limit, cursor)

    @app.post("/api/v1/ai/conversations/{conversation_id}/messages", status_code=202)
    def create_message(request: Request, conversation_id: str, body: dict = Body(...)):
        principal = _principal(authorize, request, "ai:chat:use")
        _uuid(conversation_id)
        content = body.get("content") if isinstance(body, dict) else None
        request_id = body.get("requestId") if isinstance(body, dict) else None
        if not isinstance(content, str) or not content.strip() or len(content) > 4000 or not _is_uuid(request_id or ""):
            raise AiError("VALIDATION_ERROR", "El mensaje no es válido")
        session = {
            "token": _cookie(request, "portal_session"),
            "csrf": request.headers.get("x-csrf-token", ""),
            "session_id": principal["session_id"],
            "correlation_id": request.state.correlation_id,
            "deadline": principal["deadline"],
        }
        return service.post_message(principal["user_id"], conversation_id, content.strip(), request_id, session)

    @app.get("/api/v1/ai/runs/{run_id}")
    def get_run(request: Request, run_id: str):
        principal = _principal(authorize, request, "ai:chat:use")
        _uuid(run_id)
        return service.get_run(principal["user_id"], run_id)

    @app.get("/api/v1/ai/runs/{run_id}/events")
    def stream_run(request: Request, run_id: str):
        principal = _principal(authorize, request, "ai:chat:use")
        _uuid(run_id)
        after = int(request.headers.get("last-event-id") or "0")
        events = service.events(principal["user_id"], run_id, after)

        def render():
            for event in events:
                yield f"id: {event['id']}\nevent: {event['type']}\ndata: {json.dumps(_public_event(event))}\n\n"

        return StreamingResponse(render(), media_type="text/event-stream")

    @app.post("/api/v1/ai/runs/{run_id}/cancel")
    def cancel_run(request: Request, run_id: str):
        principal = _principal(authorize, request, "ai:chat:use")
        _uuid(run_id)
        return service.cancel(principal["user_id"], run_id)

    @app.get("/api/v1/ai/me/metrics")
    def own_metrics(request: Request):
        principal = _principal(authorize, request, "ai:metrics:read:own")
        start, end = service.day_bounds(principal["now"])
        return service.metrics(principal["user_id"], start, end)

    @app.get("/api/v1/ai/runs/{run_id}/metrics")
    def run_metrics(request: Request, run_id: str):
        _uuid(run_id)
        try:
            principal = _principal(authorize, request, "ai:metrics:read:own")
            return service.run_metrics(principal["user_id"], run_id, False)
        except AiError as error:
            if error.code != "RESOURCE_NOT_VISIBLE":
                raise
            principal = _principal(authorize, request, "ai:metrics:read:any")
            return service.run_metrics(principal["user_id"], run_id, True)

    @app.get("/api/v1/ai/admin/metrics")
    def admin_metrics(request: Request):
        principal = _principal(authorize, request, "ai:metrics:read:any")
        start, end = service.day_bounds(principal["now"])
        return service.metrics(None, start, end)

    @app.get("/api/v1/ai/admin/users/{user_id}/metrics")
    def user_metrics(request: Request, user_id: str):
        principal = _principal(authorize, request, "ai:metrics:read:any")
        _uuid(user_id)
        start, end = service.day_bounds(principal["now"])
        body = service.metrics(user_id, start, end)
        body.pop("items", None)
        return body

    @app.get("/api/v1/ai/admin/alerts")
    def alerts(request: Request):
        _principal(authorize, request, "ai:alerts:read")
        page, page_size, _sort = _page(request)
        return service.alerts(page, page_size)

    @app.post("/api/v1/ai/admin/alerts/{alert_id}/acknowledge")
    def acknowledge(request: Request, alert_id: str):
        principal = _principal(authorize, request, "ai:alerts:acknowledge")
        _uuid(alert_id)
        return service.acknowledge(alert_id, principal["user_id"], request.state.correlation_id)

    @app.get("/api/v1/ai/admin/alert-rules")
    def list_rules(request: Request):
        _principal(authorize, request, "ai:alerts:configure")
        page, page_size, _sort = _page(request)
        return service.list_rules(page, page_size)

    @app.put("/api/v1/ai/admin/alert-rules")
    def replace_rules(request: Request, body: dict = Body(...)):
        _principal(authorize, request, "ai:alerts:configure")
        return service.replace_rules(int(body["version"]), body["rules"])

    @app.get("/api/v1/ai/admin/documents")
    def documents(request: Request):
        _principal(authorize, request, "ai:documents:read")
        page, page_size, _sort = _page(request)
        return service.list_documents(page, page_size)

    @app.get("/api/v1/ai/admin/indexing-jobs/{job_id}")
    def indexing_job(request: Request, job_id: str):
        _principal(authorize, request, "ai:documents:read")
        _uuid(job_id)
        return service.get_job(job_id)

    @app.post("/api/v1/ai/admin/documents/{document_id}/reindex", status_code=202)
    def reindex(request: Request, document_id: str):
        _principal(authorize, request, "ai:documents:reindex")
        _uuid(document_id)
        return service.reindex(document_id)


def install_errors(app):
    @app.exception_handler(AiError)
    async def handle(request, error: AiError):
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=_status(error.code), content={"code": error.code, "message": error.message, "correlationId": getattr(request.state, "correlation_id", "00000000-0000-4000-8000-000000000000")})


def _principal(authorize, request, permission):
    if request.method != "GET":
        _csrf(request)
    if request.query_params.get("token") or request.query_params.get("access_token"):
        raise AiError("VALIDATION_ERROR", "La dirección no puede llevar credenciales")
    return authorize(_cookie(request, "portal_session"), permission)


def _csrf(request):
    cookie = _cookie(request, "portal_csrf")
    header = request.headers.get("x-csrf-token", "")
    if not cookie or cookie != header:
        raise AiError("CSRF_INVALID", "La verificación de la sesión no coincide")


def _cookie(request, name: str) -> str:
    raw = request.headers.get("cookie", "")
    for part in raw.split(";"):
        if "=" not in part:
            continue
        key, value = part.strip().split("=", 1)
        if key == name:
            return value
    return ""


def _page(request):
    page = int(request.query_params.get("page") or "1")
    page_size = int(request.query_params.get("pageSize") or "20")
    sort = request.query_params.get("sort") or "-createdAt"
    if page < 1 or page_size < 1 or page_size > 100 or sort not in {"createdAt", "-createdAt"}:
        raise AiError("VALIDATION_ERROR", "La página no es válida")
    return page, page_size, sort


def _uuid(value: str) -> None:
    if not _is_uuid(value):
        raise AiError("VALIDATION_ERROR", "El identificador no es válido")


def _is_uuid(value: str) -> bool:
    import re

    return re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", value) is not None


def _public_event(event: dict) -> dict:
    body = {"type": event["type"]}
    if event["type"] == "confirmation_required":
        body["proposalId"] = event["proposalId"]
    elif event.get("text"):
        body["text"] = event["text"]
    return body


def _status(code: str) -> int:
    return {"SESSION_INVALID": 401, "CSRF_INVALID": 403, "PERMISSION_DENIED": 403, "RESOURCE_NOT_VISIBLE": 404, "CONFLICT": 409, "RATE_LIMITED": 429, "DEPENDENCY_UNAVAILABLE": 503}.get(code, 422)


def query(params: dict) -> str:
    return urlencode(params)
