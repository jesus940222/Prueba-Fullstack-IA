import { handleDelivery } from "../../domain/delivery";
import type { AuditInserter } from "../../domain/delivery";
import { writeLog } from "../logging/write-log";

export function startAuditConsumer(rabbitUrl: string, store: AuditInserter, attempts: number): () => void {
  if (rabbitUrl === "") {
    return () => undefined;
  }
  let connection: { close: () => Promise<void> } | undefined;
  let stopped = false;
  void consume().catch(() => {
    writeLog({ level: "error", event: "audit_consume_failed", dependency: "rabbitmq", errorCode: "consume_failed" });
  });
  return () => {
    stopped = true;
    void connection?.close();
  };

  async function consume(): Promise<void> {
    const amqplib = await import("amqplib");
    const opened = await amqplib.connect(rabbitUrl);
    connection = opened;
    const channel = await opened.createChannel();
    await channel.prefetch(10);
    await channel.consume("audit.events", (message) => {
      if (!message || stopped) {
        return;
      }
      void handleDelivery(message.content.toString(), store, attempts, message.fields.redelivered, new Date().toISOString()).then((decision) => {
        if (decision === "ack") {
          channel.ack(message);
          return;
        }
        channel.nack(message, false, false);
      }).catch(() => {
        channel.nack(message, false, false);
      });
    });
    writeLog({ level: "info", event: "audit_consumer_started" });
  }
}

export async function reprocessDeadLetters(rabbitUrl: string, store: AuditInserter, limit: number): Promise<{ acknowledged: number; kept: number }> {
  const amqplib = await import("amqplib");
  const connection = await amqplib.connect(rabbitUrl);
  let acknowledged = 0;
  let kept = 0;
  try {
    const channel = await connection.createChannel();
    for (let index = 0; index < limit; index += 1) {
      const message = await channel.get("audit.events.dlq", { noAck: false });
      if (!message) {
        break;
      }
      const decision = await handleDelivery(message.content.toString(), store, 1, true, new Date().toISOString());
      if (decision === "ack") {
        channel.ack(message);
        acknowledged += 1;
        continue;
      }
      channel.nack(message, false, true);
      kept += 1;
      break;
    }
  } finally {
    await connection.close();
  }
  return { acknowledged, kept };
}
