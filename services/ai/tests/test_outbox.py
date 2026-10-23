import json

from portal_ai.infrastructure.messaging.outbox import deliver, publish_pending


class Channel:
    def __init__(self):
        self.sent = []

    def basic_publish(self, exchange, routing_key, body):
        self.sent.append((exchange, routing_key, body))


class Connection:
    def __init__(self):
        self.channel_ref = Channel()

    def channel(self):
        return self.channel_ref


def test_outbox_publishes_the_envelope_without_a_transcript():
    connection = Connection()
    event = {
        "event_id": "11111111-1111-4111-8111-111111111111",
        "event_type": "ai.run.completed",
        "schema_version": 1,
        "source_service": "ai",
        "payload": {"run_id": "22222222-2222-4222-8222-222222222222", "usage_complete": False, "estimated_cost_usd": None},
    }
    assert deliver(connection, [event]) == 1
    body = json.loads(connection.channel_ref.sent[0][2])
    assert body["payload"]["run_id"] == event["payload"]["run_id"]
    assert "content" not in body["payload"]
    assert publish_pending("", [event]) == 0
