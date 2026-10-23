import { withRetry } from "../../application/resilience";
import type { ProbeStatus } from "../../application/readiness";

export interface PingClient {
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

export async function probeRedis(open: () => Promise<PingClient>): Promise<ProbeStatus> {
  return withRetry<ProbeStatus>(async () => {
    const client = await open();
    try {
      const reply = await client.ping();
      if (reply !== "PONG") {
        throw new Error("unexpected_ping");
      }
      return "up";
    } finally {
      await client.quit();
    }
  }, 2, 50);
}
