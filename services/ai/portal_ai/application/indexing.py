from portal_ai.domain.knowledge import DocumentView, chunk_document, content_hash
from portal_ai.domain.pricing import PriceTable, estimate_cost
from portal_ai.domain.usage import UsageSample, aggregate


def index_document(store, document: dict, embed, prices: PriceTable, new_id, model: str, dimensions: int) -> dict:
    if document["deleted_at"] is not None or document["status"] != "active":
        job = _job(new_id, document["id"], model, dimensions, "failed", 0, "document_inactive")
        store.jobs[job["id"]] = job
        return job
    chunks = chunk_document(document["body"])
    job = _job(new_id, document["id"], model, dimensions, "running", 0, None)
    job["content_hash"] = document.get("content_hash")
    store.jobs[job["id"]] = job
    vectors = []
    samples = []
    for chunk in chunks:
        vector, sample = embed(chunk.text)
        if len(vector) != dimensions:
            job["status"] = "failed"
            job["error_code"] = "invalid_dimensions"
            return job
        samples.append(sample)
        vectors.append({"id": f"{document['id']}:{document['version']}:{chunk.index}", "vector": vector, "payload": _payload(document, chunk)})
    store.vectors = [item for item in store.vectors if item["payload"]["document_id"] != document["id"]] + vectors
    total = aggregate(samples, None, include_indexing=True)
    job["status"] = "completed"
    job["processed_chunks"] = len(chunks)
    job["estimated_cost_usd"] = estimate_cost(total, prices, "embedding")
    job["usage_complete"] = total.complete
    return job


def authoritative_documents(store) -> dict[str, DocumentView]:
    views = {}
    for document in store.documents.values():
        views[document["id"]] = DocumentView(
            document["id"],
            document["code"],
            document["version"],
            document["audience"],
            document.get("application", "portal"),
            document["status"] == "active",
            document["deleted_at"] is not None,
            document["content_hash"],
        )
    return views


def _payload(document: dict, chunk) -> dict:
    return {
        "document_id": document["id"],
        "version": document["version"],
        "section": chunk.section,
        "audience": document["audience"],
        "application": "portal",
        "active": True,
        "deleted": False,
        "chunk_index": chunk.index,
        "content_hash": content_hash(chunk.text),
        "model": "text-embedding-3-large",
        "dimensions": 3072,
        "text": chunk.text,
    }


def _job(new_id, document_id, model, dimensions, status, processed, error) -> dict:
    return {
        "id": new_id(),
        "document_id": document_id,
        "embedding_model": model,
        "dimensions": dimensions,
        "status": status,
        "processed_chunks": processed,
        "error_code": error,
        "content_hash": None,
    }
