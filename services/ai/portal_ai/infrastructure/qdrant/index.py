import uuid

from qdrant_client.http.models import FieldCondition, Filter, FilterSelector, MatchValue, PointStruct

NAMESPACE = uuid.UUID("6f0b9c2e-7a31-4d5e-9c11-2b8e4a6d0f73")


def point_identity(document_id: str, version: int, index: int) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{document_id}:{version}:{index}"))


def replace_document(client, collection: str, document_id: str, vectors: list[dict]) -> None:
    client.delete(
        collection_name=collection,
        points_selector=FilterSelector(
            filter=Filter(must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))])
        ),
    )
    if not vectors:
        return
    points = []
    for item in vectors:
        payload = dict(item["payload"])
        points.append(
            PointStruct(
                id=point_identity(str(payload["document_id"]), int(payload["version"]), int(payload.get("chunk_index", 0))),
                vector=item["vector"],
                payload=payload,
            )
        )
    client.upsert(collection_name=collection, points=points)
