import amqp from "amqplib";
import type { BrokerClient } from "./rabbit.probe";

export async function openRabbit(url: string): Promise<BrokerClient> {
  const connection = await amqp.connect(url, { timeout: 1000 });
  return connection;
}
