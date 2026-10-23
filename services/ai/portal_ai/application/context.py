from contextvars import ContextVar

current_run: ContextVar[str | None] = ContextVar("current_run", default=None)
