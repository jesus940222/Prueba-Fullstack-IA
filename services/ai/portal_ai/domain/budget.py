from portal_ai.domain.money import format_decimal, parse_decimal


def within_hard_cap(spent_micro: int, reserved_micro: int, estimate_micro: int, cap_micro: int) -> bool:
    if min(spent_micro, reserved_micro, estimate_micro, cap_micro) < 0:
        raise ValueError("invalid_budget")
    return spent_micro + reserved_micro + estimate_micro <= cap_micro


def percent_reached(observed: str, threshold: str) -> bool:
    return parse_decimal(observed) >= parse_decimal(threshold)


def format_micro(value: int) -> str:
    return format_decimal(value)
