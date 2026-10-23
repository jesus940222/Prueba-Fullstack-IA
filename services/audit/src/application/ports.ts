import type { PageQuery } from "../domain/pagination";
import type { AuditRecord } from "../domain/envelope";
import type { AuditFilter } from "../domain/range";

export interface Principal {
  userId: string;
  sessionId: string;
}

export interface Authorizer {
  authorize(sessionToken: string, permission: string, requireRecentVerification: boolean): Promise<Principal>;
}

export interface Clock {
  now(): Date;
}

export interface Ids {
  uuid(): string;
}

export interface Page<T> {
  items: T[];
  totalItems: number;
}

export interface AuditStore {
  insert(record: AuditRecord): Promise<"inserted" | "duplicate">;
  search(filter: AuditFilter, query: PageQuery): Promise<Page<AuditRecord>>;
  find(eventId: string): Promise<AuditRecord | null>;
}
