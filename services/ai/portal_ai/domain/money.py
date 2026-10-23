"""USD estimado en microdólares. Un microdólar es una millonésima de dólar."""

MICRO = 1_000_000


def parse_decimal(value: str, scale: int = 6) -> int:
    text = value.strip()
    if text.startswith("-") or "." not in text:
        raise ValueError("invalid_decimal")
    whole, fraction = text.split(".", 1)
    if not whole.isdigit() or not fraction.isdigit() or not 2 <= len(fraction) <= scale:
        raise ValueError("invalid_decimal")
    if whole != "0" and whole.startswith("0"):
        raise ValueError("invalid_decimal")
    padded = fraction.ljust(scale, "0")
    return int(whole) * (10**scale) + int(padded)


def format_decimal(micro: int, scale: int = 6) -> str:
    if micro < 0:
        raise ValueError("invalid_decimal")
    whole, remainder = divmod(micro, 10**scale)
    fraction = f"{remainder:0{scale}d}".rstrip("0")
    if len(fraction) < 2:
        fraction = fraction.ljust(2, "0")
    return f"{whole}.{fraction}"


def rate_per_million(value: str) -> int:
    """Convierte una tarifa USD por millón de tokens a microdólares por token."""
    text = value.strip()
    if text.isdigit():
        return int(text) * MICRO
    if "." not in text:
        raise ValueError("invalid_rate")
    whole, fraction = text.split(".", 1)
    if not whole.isdigit() or not fraction.isdigit() or len(fraction) > 6:
        raise ValueError("invalid_rate")
    if whole != "0" and whole.startswith("0"):
        raise ValueError("invalid_rate")
    micros = int(whole) * MICRO + int(fraction.ljust(6, "0"))
    return micros
