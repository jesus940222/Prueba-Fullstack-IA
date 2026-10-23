import json
import os
import time
import urllib.error
import urllib.request


def value(name: str) -> str:
    raw = os.environ.get(name, "")
    if raw == "":
        raise SystemExit("missing_broker_setting")
    return raw


def request(method: str, path: str, body: dict | None = None) -> int:
    data = None if body is None else json.dumps(body).encode()
    call = urllib.request.Request(
        f"http://rabbitmq:15672/api{path}",
        data=data,
        method=method,
        headers={"content-type": "application/json"},
    )
    password = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    password.add_password(None, "http://rabbitmq:15672", value("RABBITMQ_ADMIN_USER"), value("RABBITMQ_ADMIN_PASSWORD"))
    opener = urllib.request.build_opener(urllib.request.HTTPBasicAuthHandler(password))
    try:
        with opener.open(call, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        if error.code in (204, 404):
            return error.code
        raise


def wait_until_ready() -> None:
    for _ in range(30):
        try:
            if request("GET", "/overview") == 200:
                return
        except Exception:
            time.sleep(2)
    raise SystemExit("broker_management_unavailable")


def main() -> None:
    wait_until_ready()
    request("PUT", "/exchanges/%2F/portal.events", {"type": "topic", "durable": True, "auto_delete": False, "internal": False, "arguments": {}})
    request("PUT", "/exchanges/%2F/portal.events.dlx", {"type": "topic", "durable": True, "auto_delete": False, "internal": False, "arguments": {}})
    request(
        "PUT",
        "/queues/%2F/audit.events",
        {
            "durable": True,
            "auto_delete": False,
            "arguments": {"x-dead-letter-exchange": "portal.events.dlx", "x-dead-letter-routing-key": "audit.events"},
        },
    )
    request("PUT", "/queues/%2F/audit.events.dlq", {"durable": True, "auto_delete": False, "arguments": {}})
    request("POST", "/bindings/%2F/e/portal.events/q/audit.events", {"routing_key": "#", "arguments": {}})
    request("POST", "/bindings/%2F/e/portal.events.dlx/q/audit.events.dlq", {"routing_key": "audit.events", "arguments": {}})
    publishers = ["ACCESS", "ACCOUNTS", "CATALOG", "AI"]
    for name in publishers:
        user = value(f"RABBITMQ_{name}_USER")
        request("PUT", f"/users/{user}", {"password": value(f"RABBITMQ_{name}_PASSWORD"), "tags": ""})
        request("PUT", f"/permissions/%2F/{user}", {"configure": "^$", "write": "^portal\\.events$", "read": "^$"})
    audit_user = value("RABBITMQ_AUDIT_USER")
    request("PUT", f"/users/{audit_user}", {"password": value("RABBITMQ_AUDIT_PASSWORD"), "tags": ""})
    request(
        "PUT",
        f"/permissions/%2F/{audit_user}",
        {"configure": "^$", "write": "^$", "read": "^(audit\\.events|audit\\.events\\.dlq)$"},
    )
    request("DELETE", "/users/guest")
    print("rabbit_bootstrap_ok")


if __name__ == "__main__":
    main()
