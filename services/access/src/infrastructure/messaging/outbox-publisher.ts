import type { AccessStore } from "../../application/access-store";
import { writeLog } from "../logging/write-log";

const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000001";

export function startOutboxPublisher(store: AccessStore, rabbitUrl: string): () => void {
  if (rabbitUrl === "") {
    return () => undefined;
  }
  const timer = setInterval(() => {
    void publishPending(store, rabbitUrl);
  }, 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function publishPending(store: AccessStore, rabbitUrl: string): Promise<void> {
  const pending = await store.unpublishedOutbox(20);
  if (pending.length === 0) {
    return;
  }
  try {
    const amqplib = await import("amqplib");
    const connection = await amqplib.connect(rabbitUrl);
    const channel = await connection.createChannel();
    for (const event of pending) {
      const userId = typeof event.payload.user_id === "string" ? event.payload.user_id : SYSTEM_ACTOR;
      const envelope = {
        event_id: event.id,
        event_type: event.eventType,
        schema_version: 1,
        occurred_at: event.occurredAt,
        source_service: "access",
        actor_type: userId === SYSTEM_ACTOR ? "system" : "user",
        actor_id: userId,
        correlation_id: event.id,
        causation_id: null,
        payload: event.payload,
      };
      channel.publish("portal.events", event.eventType, Buffer.from(JSON.stringify(envelope)), { persistent: true });
      await store.markOutboxPublished(event.id, new Date().toISOString());
    }
    await channel.close();
    await connection.close();
  } catch {
    writeLog({ level: "error", event: "outbox_publish_failed", dependency: "rabbitmq", errorCode: "publish_failed" });
  }
}
