import json

from portal_ai.application.errors import ProviderError
from portal_ai.infrastructure.openai_api import OpenAIModel, responses_body
from portal_ai.infrastructure.persistence.state import _json
from portal_ai.infrastructure.service_token import service_token
from portal_ai.infrastructure.session_client import SessionClient


class Body:
    def __init__(self, payload, status=200):
        self.status = status
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def test_responses_request_uses_tools_without_hosted_capabilities():
    body = responses_body(
        "gpt-6-luna",
        "reglas",
        [{"role": "user", "content": "hola"}, {"role": "tool", "content": "secreto"}],
        ["list_my_accounts", "prepare_transfer", "execute_sql"],
    )
    assert body["store"] is False
    assert body["reasoning"] == {"effort": "low"}
    assert "temperature" not in body
    assert [tool["name"] for tool in body["tools"]] == ["list_my_accounts", "prepare_transfer"]
    assert body["input"][0] == {"role": "user", "content": "hola"}
    assert body["input"][1]["content"].startswith("Observación de herramienta.")
    assert "no confirma" in body["input"][1]["content"]
    assert "secreto" in body["input"][1]["content"]
    prepare = body["tools"][1]["parameters"]
    assert prepare["additionalProperties"] is False
    assert set(prepare["required"]) == set(prepare["properties"])
    assert "minLength" not in json.dumps(prepare)
    assert prepare["properties"]["currency"] == {"type": "string", "enum": ["MXN"]}
    assert prepare["properties"]["beneficiaryId"]["anyOf"][1] == {"type": "null"}


def test_openai_model_parses_a_controlled_response_and_rejects_a_missing_key():
    seen = {}

    def opener(call, timeout):
        seen["url"] = call.full_url
        seen["auth"] = call.headers["Authorization"]
        return Body({"id": "resp-1", "output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}], "usage": {"input_tokens": 3, "output_tokens": 1, "input_tokens_details": {"cached_tokens": 0}}})

    model = OpenAIModel("sk-test", "gpt-6-luna", opener)
    turn = model.complete({"instructions": "reglas", "messages": [{"role": "user", "content": "hola"}], "tools": []})
    assert turn.text == "ok"
    assert seen["url"] == "https://api.openai.com/v1/responses"
    assert "sk-test" not in json.dumps(turn.usage.__dict__)
    try:
        OpenAIModel("", "gpt-6-luna", opener).complete({"instructions": "", "messages": [], "tools": []})
        raise AssertionError("missing key should fail")
    except ProviderError as error:
        assert error.code == "unavailable"


def test_session_client_keeps_the_token_out_of_the_url_and_retries_get():
    calls = []

    def opener(call, timeout):
        calls.append(call.full_url)
        status = 503 if len(calls) == 1 else 200
        return Body({"items": []}, status)

    client = SessionClient("http://accounts:3002", opener)
    status, _payload = client.get("/api/v1/accounts/accounts", {"token": "session-token", "csrf": "csrf"})
    assert status == 200
    assert len(calls) == 2
    assert all("session-token" not in url for url in calls)


def test_saved_state_rejects_secrets_and_the_service_token_is_three_parts():
    try:
        _json({"note": "portal_session=abc"})
        raise AssertionError("secret should not be stored")
    except RuntimeError as error:
        assert str(error) == "secret_in_state"
    token = service_token("x" * 32, "ai", "access.alert-recipients")
    assert token.count(".") == 2
    assert "x" * 32 not in token
