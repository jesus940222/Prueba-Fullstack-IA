from uuid import uuid4

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from portal_ai.application.capabilities import build_capabilities
from portal_ai.application.readiness import ReadinessService
from portal_ai.domain.correlation import resolve_correlation_id
from portal_ai.infrastructure.config import AppConfig
from portal_ai.presentation.chat_routes import install_errors, mount_chat


def create_app(readiness: ReadinessService, config: AppConfig, chat=None, authorize=None) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def correlation(request, call_next):
        correlation_id = resolve_correlation_id(request.headers.get("x-correlation-id"), lambda: str(uuid4()))
        request.state.correlation_id = str(correlation_id)
        response = await call_next(request)
        response.headers["x-correlation-id"] = str(correlation_id)
        return response

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "ai"}

    @app.get("/ready")
    def ready():
        report = readiness.execute()
        if report["status"] == "unavailable":
            return JSONResponse(status_code=503, content=report)
        return report

    @app.get("/capabilities")
    def capabilities():
        return build_capabilities(
            config.openai_api_key,
            config.qdrant_url,
            config.langsmith_tracing,
            config.langsmith_api_key,
        )

    if chat is not None and authorize is not None:
        install_errors(app)
        mount_chat(app, chat, authorize)

    return app
