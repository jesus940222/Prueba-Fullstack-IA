import { withRetry } from "../../application/resilience";
import type { ProbeStatus } from "../../application/readiness";

export interface BrokerClient {
  close(): Promise<void>;
}

export async function probeRabbit(url: string, open: () => Promise<BrokerClient>): Promise<ProbeStatus> {
  if (url.trim() === "") {
    return "not_configured";
  }
  return withRetry<ProbeStatus>(async () => {
    const client = await open();
    await client.close();
    return "up";
  }, 2, 50);
}
