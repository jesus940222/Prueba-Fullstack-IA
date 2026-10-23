import json

from portal_ai.domain.usage import UsageSample

KNOWN_USAGE = {"input_tokens", "output_tokens", "total_tokens", "input_tokens_details", "output_tokens_details"}


def parse_response(payload: dict, model: str, latency_ms: int, category: str = "chat") -> dict:
    usage = payload.get("usage")
    sample = _usage(usage, payload.get("id") or "missing-provider-id", model, latency_ms, category)
    text = None
    tool_name = None
    arguments = None
    for item in payload.get("output") or []:
        if item.get("type") == "reasoning":
            continue
        if item.get("type") == "function_call" and tool_name is None:
            tool_name = item.get("name")
            raw = item.get("arguments") or "{}"
            arguments = json.loads(raw) if isinstance(raw, str) else raw
        if item.get("type") == "message" and text is None:
            for part in item.get("content") or []:
                if part.get("type") == "output_text":
                    text = part.get("text") or ""
    return {"text": text, "tool_name": tool_name, "arguments": arguments, "usage": sample, "model": model, "provider_request_id": sample.provider_request_id}


def _usage(usage: dict | None, request_id: str, model: str, latency_ms: int, category: str) -> UsageSample:
    if not isinstance(usage, dict) or any(key not in KNOWN_USAGE for key in usage):
        return UsageSample(request_id, model, category, latency_ms, None, None, None, None, False)
    details = usage.get("input_tokens_details")
    if not isinstance(details, dict) or "cached_tokens" not in details or "input_tokens" not in usage or "output_tokens" not in usage:
        return UsageSample(request_id, model, category, latency_ms, None, None, None, None, False)
    cached = details.get("cached_tokens")
    write = details.get("cache_write_tokens", 0)
    if not isinstance(cached, int) or not isinstance(write, int):
        return UsageSample(request_id, model, category, latency_ms, None, None, None, None, False)
    return UsageSample(request_id, model, category, latency_ms, usage["input_tokens"], usage["output_tokens"], cached, write, True)
