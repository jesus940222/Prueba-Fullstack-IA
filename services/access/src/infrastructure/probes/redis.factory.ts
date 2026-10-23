import Redis from "ioredis";
import type { PingClient } from "./redis.probe";

export async function openRedis(url: string): Promise<PingClient> {
  const client = new Redis(url, {
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  await client.connect();
  return client;
}
