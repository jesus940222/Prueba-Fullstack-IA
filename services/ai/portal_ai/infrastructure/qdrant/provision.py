import time
import urllib.request

from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, PayloadSchemaType, VectorParams

FIELDS = {
    "document_id": PayloadSchemaType.KEYWORD,
    "version": PayloadSchemaType.INTEGER,
    "audience": PayloadSchemaType.KEYWORD,
    "application": PayloadSchemaType.KEYWORD,
    "active": PayloadSchemaType.BOOL,
    "deleted": PayloadSchemaType.BOOL,
}


def provision(url: str, size: int) -> None:
    for _ in range(30):
        try:
            with urllib.request.urlopen(f"{url.rstrip('/')}/healthz", timeout=2) as response:
                if response.status == 200:
                    break
        except Exception:
            time.sleep(2)
    else:
        raise RuntimeError("qdrant_unavailable")
    client = QdrantClient(url=url, timeout=5)
    names = {item.name for item in client.get_collections().collections}
    if "knowledge" not in names:
        client.create_collection(
            collection_name="knowledge",
            vectors_config=VectorParams(size=size, distance=Distance.COSINE),
        )
    for field, schema in FIELDS.items():
        try:
            client.create_payload_index(collection_name="knowledge", field_name=field, field_schema=schema)
        except Exception as error:
            if "already exists" not in str(error).lower():
                raise
