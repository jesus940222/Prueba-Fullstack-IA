import { withRetry } from "../../application/resilience";
import type { ProbeStatus } from "../../application/readiness";

export interface DocumentClient {
  ping(): Promise<void>;
  close(): Promise<void>;
}

export async function probeMongo(open: () => Promise<DocumentClient>): Promise<ProbeStatus> {
  return withRetry<ProbeStatus>(async () => {
    const client = await open();
    try {
      await client.ping();
      return "up";
    } finally {
      await client.close();
    }
  }, 2, 50);
}
