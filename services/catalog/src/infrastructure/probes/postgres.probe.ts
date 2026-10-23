import { withRetry } from "../../application/resilience";
import type { ProbeStatus } from "../../application/readiness";

export interface SqlClient {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export async function probePostgres(open: () => Promise<SqlClient>): Promise<ProbeStatus> {
  return withRetry<ProbeStatus>(async () => {
    const client = await open();
    try {
      await client.query("SELECT 1");
      return "up";
    } finally {
      await client.end();
    }
  }, 2, 50);
}
