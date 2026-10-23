def presence(value: str) -> str:
    return "configured" if value.strip() else "missing"


def build_capabilities(openai_api_key: str, qdrant_url: str, langsmith_tracing: bool, langsmith_api_key: str) -> dict:
    langsmith = "configured" if langsmith_tracing and langsmith_api_key.strip() else "missing"
    capabilities = [
        {"name": "openai", "status": presence(openai_api_key), "verified": False},
        {"name": "qdrant", "status": presence(qdrant_url), "verified": False},
        {"name": "langsmith", "status": langsmith, "verified": False},
    ]
    return {"capabilities": capabilities}
