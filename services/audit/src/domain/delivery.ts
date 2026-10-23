import { acceptEnvelope } from "./envelope";
import type { AuditRecord } from "./envelope";

export type InsertResult = "inserted" | "duplicate";

export interface AuditInserter {
  insert(record: AuditRecord): Promise<InsertResult>;
}

export async function handleDelivery(raw: string, store: AuditInserter, attempts: number, redelivered: boolean, receivedAt: string): Promise<"ack" | "dead"> {
  const accepted = acceptEnvelope(raw, receivedAt);
  if (!accepted.ok) {
    return "dead";
  }
  const tries = redelivered ? 1 : Math.max(1, attempts);
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const result = await store.insert(accepted.record);
      if (result === "inserted" || result === "duplicate") {
        return "ack";
      }
    } catch {
      continue;
    }
  }
  return "dead";
}
