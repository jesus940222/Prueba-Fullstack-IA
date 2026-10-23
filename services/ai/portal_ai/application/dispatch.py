from portal_ai.domain.knowledge import INSUFFICIENT_EVIDENCE, RetrievedChunk, visible_chunks
from portal_ai.domain.tools import canonical_arguments
from portal_ai.domain.transfer import card_from_proposal


class ToolDispatcher:
    def __init__(self, accounts, catalog, retriever, documents):
        self.accounts = accounts
        self.catalog = catalog
        self.retriever = retriever
        self.documents = documents

    def execute(self, name: str, arguments: dict, session: dict, audiences: set[str], effect_key: str | None) -> dict:
        if name == "search_documentation":
            hits = self.retriever.search(arguments["query"])
            visible = visible_chunks(hits, self.documents(), audiences, "portal")
            return {
                "chunks": [chunk.__dict__ for chunk in visible],
                "sufficient": len(visible) > 0,
                "sources": [_source(chunk) for chunk in visible],
            }
        if name == "list_my_accounts":
            return _reduced(self.accounts.get("/api/v1/accounts/accounts?page=1&pageSize=20", session))
        if name == "list_my_transactions":
            account_id = arguments["accountId"]
            limit = arguments.get("limit", 20)
            return _reduced(self.accounts.get(f"/api/v1/accounts/accounts/{account_id}/movements?page=1&pageSize={limit}", session))
        if name == "list_my_beneficiaries":
            query = []
            if arguments.get("search"):
                query.append(f"search={arguments['search']}")
            if arguments.get("cursor"):
                query.append(f"cursor={arguments['cursor']}")
            suffix = f"?{'&'.join(query)}" if query else ""
            return _reduced(self.accounts.get(f"/api/v1/accounts/beneficiaries{suffix}", session))
        if name == "get_my_transfer_limits":
            return _reduced(self.accounts.get("/api/v1/accounts/me/transfer-limits", session))
        if name == "list_products":
            page = arguments.get("page", 1)
            return _reduced(self.catalog.get(f"/api/v1/catalog/products?page={page}&pageSize=20", session))
        if name == "list_my_offers":
            return _reduced(self.catalog.get("/api/v1/catalog/me/offers?page=1&pageSize=20", session))
        if name == "prepare_transfer":
            if effect_key is None:
                raise ValueError("missing_effect_key")
            body = {
                "sourceAccountId": arguments["sourceAccountId"],
                "amount": arguments["amount"],
                "currency": "MXN",
                "concept": arguments["concept"],
            }
            if "beneficiaryId" in arguments:
                body["beneficiaryId"] = arguments["beneficiaryId"]
            else:
                body["destinationAccountNumber"] = arguments["destinationAccountNumber"]
            status, payload = self.accounts.post("/api/v1/accounts/transfer-proposals", session, body, effect_key)
            if status != 201:
                return {"error": "not_prepared", "status": status}
            return {"card": card_from_proposal(payload), "effect": canonical_arguments(arguments)}
        raise ValueError("unknown_tool")


def hits_from_dicts(items: list[dict]) -> list[RetrievedChunk]:
    return [RetrievedChunk(**item) for item in items]


def _reduced(result: tuple[int, dict]) -> dict:
    status, payload = result
    if status in {401, 403, 404}:
        return {"error": "not_visible"}
    if status == 429:
        return {"error": "rate_limited"}
    if status != 200:
        return {"error": "unavailable"}
    return {"data": payload}


def _source(chunk: RetrievedChunk) -> dict:
    return {"documentId": chunk.document_id, "version": chunk.version, "section": chunk.section}


INSUFFICIENT = INSUFFICIENT_EVIDENCE
