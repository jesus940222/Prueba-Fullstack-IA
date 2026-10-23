import { publishPending } from "../../application/outbox";
import type { CatalogStore } from "../../application/ports";
import type { OutboxRecord } from "../../domain/records";
import { writeLog } from "../logging/write-log";

export function startOutboxPublisher(store: CatalogStore, rabbitUrl: string): () => void {
  if (rabbitUrl === "") {
    return () => undefined;
  }
  const timer = setInterval(() => {
    void publishPending(store, { publish: (events) => publishToRabbit(rabbitUrl, events) }, 20, new Date().toISOString()).catch(() => {
      writeLog({ level: "error", event: "outbox_publish_failed", dependency: "rabbitmq", errorCode: "publish_failed" });
    });
  }, 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function publishToRabbit(rabbitUrl: string, events: readonly OutboxRecord[]): Promise<void> {
  const amqplib = await import("amqplib");
  const connection = await amqplib.connect(rabbitUrl);
  try {
    const channel = await connection.createChannel();
    for (const event of events) {
      const envelope = {
        event_id: event.id,
        event_type: event.eventType,
        schema_version: 1,
        occurred_at: event.occurredAt,
        source_service: "catalog",
        actor_type: "user",
        actor_id: event.actorId,
        correlation_id: event.correlationId,
        causation_id: null,
        payload: event.payload,
      };
      channel.publish("portal.events", event.eventType, Buffer.from(JSON.stringify(envelope)), { persistent: true });
    }
    await channel.close();
  } finally {
    await connection.close();
  }
}
