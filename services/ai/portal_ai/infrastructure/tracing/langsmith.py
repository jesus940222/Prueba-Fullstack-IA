from portal_ai.domain.redaction import redact, safe_metadata


class LangSmithExporter:
    def __init__(self, enabled: bool, client=None, limit: int = 100):
        self.enabled = enabled
        self.client = client
        self.limit = limit
        self.sent = 0
        self.dropped = 0

    def export(self, payload: dict) -> None:
        if not self.enabled or self.client is None:
            return
        if self.sent >= self.limit:
            self.dropped += 1
            return
        safe = {
            "inputs": {},
            "outputs": {},
            "metadata": safe_metadata(payload.get("metadata") or {}),
            "extra": redact(payload.get("extra") or {}),
        }
        try:
            self.client.create_run(safe)
            self.sent += 1
        except Exception:
            return
