FROM python:3.13.9-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /uvx /bin/
WORKDIR /app
COPY services/ai/pyproject.toml services/ai/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/ai/portal_ai ./portal_ai
COPY services/ai/alembic ./alembic
COPY services/ai/alembic.ini ./alembic.ini
COPY services/ai/prompts ./prompts
COPY services/ai/eval ./eval
COPY knowledge ./knowledge

FROM python:3.13.9-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build --chown=app:app /app /app
USER app
ENV PATH="/app/.venv/bin:$PATH" PYTHONPATH="/app"
EXPOSE 3005
CMD ["uvicorn", "portal_ai.composition.app:app", "--host", "0.0.0.0", "--port", "3005"]
