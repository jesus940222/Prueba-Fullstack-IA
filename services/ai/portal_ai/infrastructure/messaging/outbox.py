import json


def deliver(connection, events: list[dict]) -> int:
    channel = connection.channel()
    for event in events:
        channel.basic_publish(
            exchange="portal.events",
            routing_key=event["event_type"],
            body=json.dumps(event).encode(),
        )
    return len(events)


def publish_pending(url: str, events: list[dict]) -> int:
    if url.strip() == "" or not events:
        return 0
    import pika

    connection = pika.BlockingConnection(pika.URLParameters(url))
    try:
        return deliver(connection, events)
    finally:
        connection.close()
