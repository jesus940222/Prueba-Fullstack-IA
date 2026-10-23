import type { AuditRecord } from "../../domain/envelope";
import type { PageQuery } from "../../domain/pagination";
import type { AuditFilter } from "../../domain/range";
import type { AuditStore, Page } from "../ports";

export class MemoryAuditStore implements AuditStore {
  records: AuditRecord[] = [];
  failInserts = 0;

  async insert(record: AuditRecord) {
    if (this.failInserts > 0) {
      this.failInserts -= 1;
      throw new Error("mongo_down");
    }
    if (this.records.some((item) => item.eventId === record.eventId)) {
      return "duplicate" as const;
    }
    this.records.push(record);
    return "inserted" as const;
  }

  async search(filter: AuditFilter, query: PageQuery): Promise<Page<AuditRecord>> {
    const items = this.records.filter((record) => matches(record, filter));
    const factor = query.sort === "createdAt" ? 1 : -1;
    items.sort((left, right) => (left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId)) * factor);
    const start = (query.page - 1) * query.pageSize;
    return { items: items.slice(start, start + query.pageSize), totalItems: items.length };
  }

  async find(eventId: string) {
    return this.records.find((record) => record.eventId === eventId) ?? null;
  }
}

function matches(record: AuditRecord, filter: AuditFilter): boolean {
  const occurred = Date.parse(record.occurredAt);
  if (occurred < Date.parse(filter.from) || occurred > Date.parse(filter.to)) {
    return false;
  }
  if (filter.actorId && record.actorId !== filter.actorId) {
    return false;
  }
  if (filter.sourceService && record.sourceService !== filter.sourceService) {
    return false;
  }
  if (filter.eventType && record.eventType !== filter.eventType) {
    return false;
  }
  if (filter.resourceType && record.resourceType !== filter.resourceType) {
    return false;
  }
  if (filter.outcome && record.outcome !== filter.outcome) {
    return false;
  }
  if (filter.correlationId && record.correlationId !== filter.correlationId) {
    return false;
  }
  return true;
}
