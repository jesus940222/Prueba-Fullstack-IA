from dataclasses import dataclass

from portal_ai.domain.money import MICRO, format_decimal, rate_per_million
from portal_ai.domain.usage import UsageTotal


@dataclass(frozen=True)
class PriceTable:
    version: str
    input_per_token: int
    cached_input_per_token: int
    cache_write_per_token: int
    output_per_token: int
    embedding_per_token: int

    @staticmethod
    def from_rates(
        observed_on: str,
        input_rate: str,
        cached_rate: str,
        cache_write_rate: str,
        output_rate: str,
        embedding_rate: str,
    ) -> "PriceTable":
        return PriceTable(
            version=f"openai-{observed_on}",
            input_per_token=rate_per_million(input_rate),
            cached_input_per_token=rate_per_million(cached_rate),
            cache_write_per_token=rate_per_million(cache_write_rate),
            output_per_token=rate_per_million(output_rate),
            embedding_per_token=rate_per_million(embedding_rate),
        )


def estimate_cost(total: UsageTotal, prices: PriceTable, category: str) -> str | None:
    if not total.complete or total.input_tokens is None or total.output_tokens is None or total.cached_tokens is None:
        return None
    rate = prices.embedding_per_token if category == "embedding" else prices.input_per_token
    uncached = total.input_tokens - total.cached_tokens
    input_cost = uncached * rate
    cached_cost = total.cached_tokens * (prices.embedding_per_token if category == "embedding" else prices.cached_input_per_token)
    write_cost = 0 if category == "embedding" else (total.cache_write_tokens or 0) * prices.cache_write_per_token
    output_cost = 0 if category == "embedding" else total.output_tokens * prices.output_per_token
    micro = (input_cost + cached_cost + write_cost + output_cost) // MICRO
    return format_decimal(micro)


def add_costs(values: list[str | None]) -> str | None:
    if any(value is None for value in values):
        return None
    from portal_ai.domain.money import parse_decimal

    return format_decimal(sum(parse_decimal(value or "0.00") for value in values))
