import json
from urllib import request as urlrequest


class SessionClient:
    def __init__(self, base_url: str, opener=urlrequest.urlopen, timeout: int = 5):
        self.base_url = base_url.rstrip("/")
        self.opener = opener
        self.timeout = timeout

    def get(self, path: str, session: dict) -> tuple[int, dict]:
        return self._send("GET", path, session, None, None)

    def post(self, path: str, session: dict, body: dict, effect_key: str | None) -> tuple[int, dict]:
        return self._send("POST", path, session, body, effect_key)

    def _send(self, method: str, path: str, session: dict, body: dict | None, effect_key: str | None) -> tuple[int, dict]:
        attempts = 2 if method == "GET" else 1
        last = (503, {})
        for _ in range(attempts):
            status, payload = self._once(method, path, session, body, effect_key)
            last = (status, payload)
            if status != 503:
                return status, payload
        return last

    def _once(self, method: str, path: str, session: dict, body: dict | None, effect_key: str | None) -> tuple[int, dict]:
        headers = {
            "cookie": f"portal_session={session.get('token', '')}; portal_csrf={session.get('csrf', '')}",
            "x-csrf-token": session.get("csrf", ""),
            "content-type": "application/json",
        }
        if effect_key:
            headers["idempotency-key"] = effect_key
        call = urlrequest.Request(f"{self.base_url}{path}", data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            with self.opener(call, timeout=self.timeout) as response:
                raw = response.read().decode()
                return response.status, json.loads(raw) if raw else {}
        except Exception as error:
            status = getattr(error, "code", None)
            if isinstance(status, int):
                return status, {}
            return 503, {}
