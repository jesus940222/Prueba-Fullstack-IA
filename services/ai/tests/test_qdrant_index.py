from portal_ai.infrastructure.qdrant.index import point_identity, replace_document


class Client:
    def __init__(self):
        self.deleted = None
        self.points = None

    def delete(self, collection_name, points_selector):
        self.deleted = collection_name

    def upsert(self, collection_name, points):
        self.points = points


def test_replace_document_uses_stable_ids_and_keeps_chunk_text():
    client = Client()
    first = point_identity("doc", 1, 0)
    replace_document(
        client,
        "knowledge",
        "doc",
        [{"vector": [0.1, 0.2], "payload": {"document_id": "doc", "version": 1, "chunk_index": 0, "text": "uso del portal", "audience": "general"}}],
    )
    assert client.deleted == "knowledge"
    assert client.points[0].id == first
    assert client.points[0].payload["text"] == "uso del portal"
    assert "sk-" not in str(client.points[0].payload)
    replace_document(client, "knowledge", "doc", [])
    assert client.points[0].id == first
