import base64
import hashlib
import hmac
import json
import time


def service_token(secret: str, issuer: str, audience: str) -> str:
    header = _part({"alg": "HS256", "typ": "JWT"})
    payload = _part({"iss": issuer, "aud": audience, "sub": issuer, "iat": int(time.time()), "exp": int(time.time()) + 120})
    signature = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{_encode(signature)}"


def _part(value: dict) -> str:
    return _encode(json.dumps(value, separators=(",", ":")).encode())


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")
