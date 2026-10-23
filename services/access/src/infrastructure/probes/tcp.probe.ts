import { withRetry } from "../../application/resilience";
import type { ProbeStatus } from "../../application/readiness";

export async function probeTcpEndpoint(url: string, open: (host: string, port: number) => Promise<void>): Promise<ProbeStatus> {
  if (url.trim() === "") {
    return "not_configured";
  }
  const parsed = new URL(url);
  const port = parsed.port === "" ? 25 : Number(parsed.port);
  if (!parsed.hostname || !Number.isInteger(port)) {
    throw new Error("invalid_endpoint");
  }
  return withRetry<ProbeStatus>(async () => {
    await open(parsed.hostname, port);
    return "up";
  }, 2, 50);
}
