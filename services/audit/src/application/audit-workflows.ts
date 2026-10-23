import { AuditError } from "../domain/audit-error";
import { queryRecord, type AuditRecord } from "../domain/envelope";
import type { PageQuery } from "../domain/pagination";
import { assertRange, type AuditFilter } from "../domain/range";
import type { AuditStore, Authorizer, Clock, Ids } from "./ports";

export interface AuditQueryInput {
  from?: string;
  to?: string;
  actorId?: string;
  sourceService?: string;
  eventType?: string;
  resourceType?: string;
  outcome?: AuditFilter["outcome"];
}

export class AuditWorkflows {
  constructor(
    private readonly store: AuditStore,
    private readonly authorizer: Authorizer,
    private readonly clock: Clock,
    private readonly ids: Ids,
    private readonly maxDays: number,
  ) {}

  async list(sessionToken: string, input: AuditQueryInput, query: PageQuery, correlationId: string) {
    const principal = await this.authorizer.authorize(sessionToken, "audit:read:any", false);
    return this.query(principal, input, query, correlationId, "events");
  }

  async listOwn(sessionToken: string, input: AuditQueryInput, query: PageQuery, correlationId: string) {
    const principal = await this.authorizer.authorize(sessionToken, "audit:read:own", false);
    return this.query(principal, { ...input, actorId: principal.userId }, query, correlationId, "me");
  }

  async listCorrelation(sessionToken: string, correlation: string, query: PageQuery, correlationId: string) {
    const principal = await this.authorizer.authorize(sessionToken, "audit:read:any", false);
    return this.query(principal, { correlationId: correlation }, query, correlationId, "correlation");
  }

  async get(sessionToken: string, eventId: string, correlationId: string) {
    const principal = await this.authorizer.authorize(sessionToken, "audit:read:any", false);
    const found = await this.store.find(eventId);
    await this.record(principal, correlationId, found ? "success" : "denied", { route: "event" });
    if (!found) {
      throw new AuditError("RESOURCE_NOT_VISIBLE", "El evento no está disponible");
    }
    return view(found);
  }

  private async query(principal: { userId: string; sessionId: string }, input: AuditQueryInput & { correlationId?: string }, query: PageQuery, correlationId: string, route: string) {
    const range = assertRange({ from: input.from, to: input.to, now: this.clock.now(), maxDays: this.maxDays });
    const filter: AuditFilter = {
      ...range,
      actorId: input.actorId,
      sourceService: input.sourceService,
      eventType: input.eventType,
      resourceType: input.resourceType,
      outcome: input.outcome,
      correlationId: input.correlationId,
    };
    const page = await this.store.search(filter, query);
    await this.record(principal, correlationId, "success", { route, page: query.page });
    return { ...page, items: page.items.map(view) };
  }

  private async record(principal: { userId: string }, correlationId: string, outcome: AuditRecord["outcome"], metadata: Record<string, string | number | boolean | null>) {
    await this.store.insert(queryRecord({
      eventId: this.ids.uuid(),
      occurredAt: this.clock.now().toISOString(),
      actorId: principal.userId,
      correlationId,
      outcome,
      metadata,
    }));
  }
}

export function view(record: AuditRecord) {
  return {
    eventId: record.eventId,
    eventType: record.eventType,
    schemaVersion: record.schemaVersion,
    occurredAt: record.occurredAt,
    receivedAt: record.receivedAt,
    sourceService: record.sourceService,
    actorType: record.actorType,
    actorId: record.actorId,
    customerId: record.customerId,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    action: record.action,
    outcome: record.outcome,
    reasonCode: record.reasonCode,
    channel: record.channel,
    correlationId: record.correlationId,
  };
}
