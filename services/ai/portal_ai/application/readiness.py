from collections.abc import Callable


def public_error_code(error: BaseException) -> str:
    if str(error) == "timeout":
        return "timeout"
    return "dependency_unreachable"


class ReadinessService:
    def __init__(self, service_name: str, probes: list[tuple[str, bool, Callable[[], str]]]):
        self.service_name = service_name
        self.probes = probes

    def execute(self) -> dict:
        checks = []
        for name, required, check in self.probes:
            try:
                checks.append({"name": name, "status": check(), "required": required})
            except Exception as error:
                checks.append(
                    {
                        "name": name,
                        "status": "down",
                        "required": required,
                        "errorCode": public_error_code(error),
                    }
                )
        required_down = any(check["required"] and check["status"] != "up" for check in checks)
        optional_down = any(not check["required"] and check["status"] != "up" for check in checks)
        status = "unavailable" if required_down else "degraded" if optional_down else "ok"
        return {"status": status, "service": self.service_name, "checks": checks}
