import type { AuditRecord } from "../../domain/envelope";
import type { PageQuery } from "../../domain/pagination";
import type { AuditFilter } from "../../domain/range";
import type { AuditStore } from "../../application/ports";

type AuditDocument = Record<string, unknown>;

interface AuditCursor {
  sort(order: Record<string, 1 | -1>): AuditCursor;
  skip(count: number): AuditCursor;
  limit(count: number): AuditCursor;
  toArray(): Promise<AuditDocument[]>;
}

interface AuditCollection {
  insertOne(document: AuditDocument): Promise<unknown>;
  countDocuments(filter: AuditDocument): Promise<number>;
  find(filter: AuditDocument): AuditCursor;
  findOne(filter: AuditDocument): Promise<AuditDocument | null>;
}

export class MongoAuditStore implements AuditStore {
  constructor(private readonly events: AuditCollection) {}

  async insert(record: AuditRecord) {
    try {
      await this.events.insertOne(documentOf(record));
      return "inserted" as const;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 11000) {
        return "duplicate" as const;
      }
      throw error;
    }
  }

  async search(filter: AuditFilter, query: PageQuery) {
    const mongoFilter = criteria(filter);
    const direction = query.sort === "createdAt" ? 1 : -1;
    const totalItems = await this.events.countDocuments(mongoFilter);
    const rows = await this.events
      .find(mongoFilter)
      .sort({ occurred_at: direction, event_id: direction })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .toArray();
    return { items: rows.map(recordOf), totalItems };
  }

  async find(eventId: string) {
    const row = await this.events.findOne({ event_id: eventId });
    return row ? recordOf(row) : null;
  }
}

function criteria(filter: AuditFilter): AuditDocument {
  const query: AuditDocument = { occurred_at: { $gte: new Date(filter.from), $lte: new Date(filter.to) } };
  if (filter.actorId) {
    query.actor_id = filter.actorId;
  }
  if (filter.sourceService) {
    query.source_service = filter.sourceService;
  }
  if (filter.eventType) {
    query.event_type = filter.eventType;
  }
  if (filter.resourceType) {
    query.resource_type = filter.resourceType;
  }
  if (filter.outcome) {
    query.outcome = filter.outcome;
  }
  if (filter.correlationId) {
    query.correlation_id = filter.correlationId;
  }
  return query;
}

function documentOf(record: AuditRecord): AuditDocument {
  return {
    event_id: record.eventId,
    event_type: record.eventType,
    schema_version: record.schemaVersion,
    occurred_at: new Date(record.occurredAt),
    received_at: new Date(record.receivedAt),
    source_service: record.sourceService,
    actor_type: record.actorType,
    actor_id: record.actorId,
    customer_id: record.customerId,
    resource_type: record.resourceType,
    resource_id: record.resourceId,
    action: record.action,
    outcome: record.outcome,
    reason_code: record.reasonCode,
    channel: record.channel,
    correlation_id: record.correlationId,
    causation_id: record.causationId,
    changes: record.changes,
    metadata: record.metadata,
  };
}

function recordOf(row: AuditDocument): AuditRecord {
  return {
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    schemaVersion: Number(row.schema_version),
    occurredAt: instant(row.occurred_at),
    receivedAt: instant(row.received_at),
    sourceService: String(row.source_service),
    actorType: row.actor_type as AuditRecord["actorType"],
    actorId: String(row.actor_id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    action: String(row.action),
    outcome: row.outcome as AuditRecord["outcome"],
    reasonCode: row.reason_code ? String(row.reason_code) : null,
    channel: row.channel as AuditRecord["channel"],
    correlationId: String(row.correlation_id),
    causationId: row.causation_id ? String(row.causation_id) : null,
    changes: Array.isArray(row.changes) ? row.changes as AuditRecord["changes"] : [],
    metadata: (row.metadata ?? {}) as AuditRecord["metadata"],
  };
}

function instant(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
