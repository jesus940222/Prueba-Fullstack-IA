from dataclasses import dataclass


@dataclass(frozen=True)
class UsageSample:
    provider_request_id: str
    model: str
    category: str
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None
    cached_tokens: int | None
    cache_write_tokens: int | None
    complete: bool

    def __post_init__(self) -> None:
        if self.category not in {"chat", "retrieval", "indexing"}:
            raise ValueError("invalid_usage_category")
        if self.latency_ms < 0:
            raise ValueError("invalid_latency")
        for value in (self.input_tokens, self.output_tokens, self.cached_tokens, self.cache_write_tokens):
            if value is not None and value < 0:
                raise ValueError("invalid_tokens")
        if self.complete and (self.input_tokens is None or self.output_tokens is None or self.cached_tokens is None):
            raise ValueError("incomplete_marked_complete")
        if (
            self.input_tokens is not None
            and self.cached_tokens is not None
            and self.cached_tokens > self.input_tokens
        ):
            raise ValueError("cached_exceeds_input")


@dataclass(frozen=True)
class UsageTotal:
    input_tokens: int | None
    output_tokens: int | None
    cached_tokens: int | None
    total_tokens: int | None
    cache_write_tokens: int | None
    complete: bool
    latency_ms: int
    time_to_first_content_ms: int | None


def aggregate(samples: list[UsageSample], time_to_first_content_ms: int | None, include_indexing: bool = False) -> UsageTotal:
    seen: set[str] = set()
    selected: list[UsageSample] = []
    for sample in samples:
        if sample.category == "indexing" and not include_indexing:
            continue
        if sample.provider_request_id in seen:
            continue
        seen.add(sample.provider_request_id)
        selected.append(sample)
    latency = sum(sample.latency_ms for sample in selected)
    if any(not sample.complete for sample in selected) or not selected:
        return UsageTotal(None, None, None, None, None, False, latency, time_to_first_content_ms)
    input_tokens = sum(sample.input_tokens or 0 for sample in selected)
    output_tokens = sum(sample.output_tokens or 0 for sample in selected)
    cached_tokens = sum(sample.cached_tokens or 0 for sample in selected)
    cache_write = sum(sample.cache_write_tokens or 0 for sample in selected)
    return UsageTotal(
        input_tokens,
        output_tokens,
        cached_tokens,
        input_tokens + output_tokens,
        cache_write,
        True,
        latency,
        time_to_first_content_ms,
    )
