const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const COST = /^(0|[1-9][0-9]{0,15})\.[0-9]{2,6}$/;
const SECRET_KEYS = new Set([
  "password",
  "password_hash",
  "token",
  "access_token",
  "refresh_token",
  "otp",
  "secret",
  "prompt",
  "reasoning",
  "transcript",
  "conversation",
  "authorization",
  "cookie",
  "biometric",
  "recovery_code",
]);

const EVENT_TYPES = [
  "session.revoked",
  "user.deleted",
  "role.updated",
  "role.assignment.changed",
  "transfer.completed",
  "transfer.rejected",
  "transfer_limits.updated",
  "beneficiary.changed",
  "product.changed",
  "offer.changed",
  "ai.run.completed",
  "ai.run.failed",
  "ai.run.cancelled",
  "ai.cost_alert.created",
  "ai.cost_alert.acknowledged",
  "notification.delivery.failed",
] as const;

const SOURCES = ["access", "accounts", "catalog", "ai"] as const;

export interface AuditRecord {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  receivedAt: string;
  sourceService: string;
  actorType: "user" | "service" | "system";
  actorId: string;
  customerId: string | null;
  resourceType: string;
  resourceId: string;
  action: string;
  outcome: "success" | "failure" | "denied";
  reasonCode: string | null;
  channel: "web" | "service" | "system";
  correlationId: string;
  causationId: string | null;
  changes: Array<{ field: string; redacted: true }>;
  metadata: Record<string, string | number | boolean | null>;
}

export type AcceptResult = { ok: true; record: AuditRecord } | { ok: false; reason: "invalid" };

export function acceptEnvelope(raw: string, receivedAt: string): AcceptResult {
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid" };
  }
  const envelope = body as Record<string, unknown>;
  if (!isEnum(envelope.event_type, EVENT_TYPES) || envelope.schema_version !== 1 || !isEnum(envelope.source_service, SOURCES)) {
    return { ok: false, reason: "invalid" };
  }
  if (!uuid(envelope.event_id) || !uuid(envelope.actor_id) || !uuid(envelope.correlation_id) || !instant(envelope.occurred_at)) {
    return { ok: false, reason: "invalid" };
  }
  if (!isEnum(envelope.actor_type, ["user", "service", "system"] as const)) {
    return { ok: false, reason: "invalid" };
  }
  if (envelope.causation_id !== undefined && envelope.causation_id !== null && !uuid(envelope.causation_id)) {
    return { ok: false, reason: "invalid" };
  }
  const payload = payloadFor(String(envelope.event_type), String(envelope.source_service), envelope.payload);
  if (!payload) {
    return { ok: false, reason: "invalid" };
  }
  const projected = project(envelope, payload, receivedAt);
  return projected ? { ok: true, record: projected } : { ok: false, reason: "invalid" };
}

export function queryRecord(input: {
  eventId: string;
  occurredAt: string;
  actorId: string;
  correlationId: string;
  outcome: AuditRecord["outcome"];
  metadata: Record<string, string | number | boolean | null>;
}): AuditRecord {
  return {
    eventId: input.eventId,
    eventType: "audit.query",
    schemaVersion: 1,
    occurredAt: input.occurredAt,
    receivedAt: input.occurredAt,
    sourceService: "audit",
    actorType: "user",
    actorId: input.actorId,
    customerId: null,
    resourceType: "audit_query",
    resourceId: input.correlationId,
    action: "query",
    outcome: input.outcome,
    reasonCode: null,
    channel: "web",
    correlationId: input.correlationId,
    causationId: null,
    changes: [],
    metadata: input.metadata,
  };
}

function project(envelope: Record<string, unknown>, payload: Record<string, unknown>, receivedAt: string): AuditRecord | null {
  const eventType = String(envelope.event_type);
  const resource = resourceOf(eventType, payload);
  if (!resource) {
    return null;
  }
  const { metadata, changes } = redact(payload);
  return {
    eventId: String(envelope.event_id),
    eventType,
    schemaVersion: 1,
    occurredAt: new Date(String(envelope.occurred_at)).toISOString(),
    receivedAt,
    sourceService: String(envelope.source_service),
    actorType: envelope.actor_type as AuditRecord["actorType"],
    actorId: String(envelope.actor_id),
    customerId: uuid(payload.customer_id) ? String(payload.customer_id) : null,
    resourceType: resource.type,
    resourceId: resource.id,
    action: resource.action,
    outcome: resource.outcome,
    reasonCode: safeReason(payload.reason_code) ?? safeReason(payload.reason),
    channel: "service",
    correlationId: String(envelope.correlation_id),
    causationId: uuid(envelope.causation_id) ? String(envelope.causation_id) : null,
    changes,
    metadata,
  };
}

function resourceOf(eventType: string, payload: Record<string, unknown>): { type: string; id: string; action: string; outcome: AuditRecord["outcome"] } | null {
  const map: Record<string, [string, string, string, AuditRecord["outcome"]]> = {
    "session.revoked": ["session", "session_id", "revoked", "success"],
    "user.deleted": ["user", "user_id", "deleted", "success"],
    "role.updated": ["role", "role_id", "updated", "success"],
    "role.assignment.changed": ["role_assignment", "assignment_id", "changed", "success"],
    "transfer.completed": ["transfer", "transfer_id", "completed", "success"],
    "transfer.rejected": ["transfer_proposal", "proposal_id", "rejected", "failure"],
    "transfer_limits.updated": ["transfer_limits", "user_id", "updated", "success"],
    "beneficiary.changed": ["beneficiary", "beneficiary_id", "changed", "success"],
    "product.changed": ["product", "product_id", "changed", "success"],
    "offer.changed": ["offer", "offer_id", "changed", "success"],
    "ai.run.completed": ["ai_run", "run_id", "completed", "success"],
    "ai.run.failed": ["ai_run", "run_id", "failed", "failure"],
    "ai.run.cancelled": ["ai_run", "run_id", "cancelled", "failure"],
    "ai.cost_alert.created": ["cost_alert", "alert_id", "created", "success"],
    "ai.cost_alert.acknowledged": ["cost_alert", "alert_id", "acknowledged", "success"],
    "notification.delivery.failed": ["notification", "delivery_id", "failed", "failure"],
  };
  const found = map[eventType];
  if (!found) {
    return null;
  }
  const id = payload[found[1]];
  if (typeof id !== "string" || id.length < 1 || id.length > 80) {
    return null;
  }
  return { type: found[0], id, action: found[2], outcome: found[3] };
}

function safeReason(value: unknown): string | null {
  if (typeof value !== "string" || value.startsWith("eyJ") || SECRET_KEYS.has(value)) {
    return null;
  }
  return value;
}

function redact(payload: Record<string, unknown>): { metadata: AuditRecord["metadata"]; changes: AuditRecord["changes"] } {
  const metadata: AuditRecord["metadata"] = {};
  const changes: AuditRecord["changes"] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (SECRET_KEYS.has(key) || (typeof value === "string" && value.startsWith("eyJ"))) {
      changes.push({ field: key, redacted: true });
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      metadata[key] = value;
    }
  }
  return { metadata, changes };
}

function payloadFor(eventType: string, source: string, payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const expected = EXPECTED[eventType];
  if (!expected || expected.source !== source) {
    return null;
  }
  const keys = Object.keys(record);
  if (keys.some((key) => !expected.keys.includes(key)) || expected.required.some((key) => !(key in record))) {
    return null;
  }
  return expected.valid(record) ? record : null;
}

const EXPECTED: Record<string, { source: string; keys: string[]; required: string[]; valid: (payload: Record<string, unknown>) => boolean }> = {
  "session.revoked": { source: "access", keys: ["session_id", "user_id", "reason"], required: ["session_id", "user_id", "reason"], valid: (payload) => uuid(payload.session_id) && uuid(payload.user_id) && text(payload.reason, 80) },
  "user.deleted": { source: "access", keys: ["user_id"], required: ["user_id"], valid: (payload) => uuid(payload.user_id) },
  "role.updated": { source: "access", keys: ["role_id", "authorization_version"], required: ["role_id", "authorization_version"], valid: (payload) => uuid(payload.role_id) && Number.isInteger(payload.authorization_version) && Number(payload.authorization_version) >= 1 },
  "role.assignment.changed": { source: "access", keys: ["user_id", "role_id", "assignment_id", "change"], required: ["user_id", "role_id", "assignment_id", "change"], valid: (payload) => uuid(payload.user_id) && uuid(payload.role_id) && uuid(payload.assignment_id) && (payload.change === "assigned" || payload.change === "revoked") },
  "transfer.completed": { source: "accounts", keys: ["transfer_id", "reference", "source_account_id", "destination_account_id", "amount", "currency"], required: ["transfer_id", "reference", "source_account_id", "destination_account_id", "amount", "currency"], valid: (payload) => uuid(payload.transfer_id) && text(payload.reference, 40) && uuid(payload.source_account_id) && uuid(payload.destination_account_id) && typeof payload.amount === "string" && MONEY.test(payload.amount) && payload.currency === "MXN" },
  "transfer.rejected": { source: "accounts", keys: ["proposal_id", "reason_code"], required: ["proposal_id", "reason_code"], valid: (payload) => uuid(payload.proposal_id) && text(payload.reason_code, 80) },
  "transfer_limits.updated": { source: "accounts", keys: ["user_id", "currency", "per_transfer_limit", "daily_limit"], required: ["user_id", "currency", "per_transfer_limit", "daily_limit"], valid: (payload) => uuid(payload.user_id) && payload.currency === "MXN" && typeof payload.per_transfer_limit === "string" && MONEY.test(payload.per_transfer_limit) && typeof payload.daily_limit === "string" && MONEY.test(payload.daily_limit) },
  "beneficiary.changed": { source: "accounts", keys: ["beneficiary_id", "customer_id", "change"], required: ["beneficiary_id", "customer_id", "change"], valid: (payload) => uuid(payload.beneficiary_id) && uuid(payload.customer_id) && (payload.change === "created" || payload.change === "updated" || payload.change === "deleted") },
  "product.changed": { source: "catalog", keys: ["product_id", "change"], required: ["product_id", "change"], valid: (payload) => uuid(payload.product_id) && ["created", "updated", "deleted", "restored"].includes(String(payload.change)) },
  "offer.changed": { source: "catalog", keys: ["offer_id", "change"], required: ["offer_id", "change"], valid: (payload) => uuid(payload.offer_id) && ["created", "updated", "deleted", "restored", "rules_replaced", "assignment_changed"].includes(String(payload.change)) },
  "ai.run.completed": { source: "ai", keys: ["run_id", "conversation_id", "model", "status", "usage_complete", "estimated_cost_usd"], required: ["run_id", "conversation_id", "model", "status", "usage_complete"], valid: (payload) => aiRun(payload, "completed") },
  "ai.run.failed": { source: "ai", keys: ["run_id", "conversation_id", "model", "status", "usage_complete", "estimated_cost_usd"], required: ["run_id", "conversation_id", "model", "status", "usage_complete"], valid: (payload) => aiRun(payload, "failed") },
  "ai.run.cancelled": { source: "ai", keys: ["run_id", "conversation_id", "model", "status", "usage_complete", "estimated_cost_usd"], required: ["run_id", "conversation_id", "model", "status", "usage_complete"], valid: (payload) => aiRun(payload, "cancelled") },
  "ai.cost_alert.created": { source: "ai", keys: ["alert_id", "rule_id", "scope", "observed_value_usd"], required: ["alert_id", "rule_id", "scope", "observed_value_usd"], valid: (payload) => uuid(payload.alert_id) && uuid(payload.rule_id) && ["run", "user_day", "global_day"].includes(String(payload.scope)) && typeof payload.observed_value_usd === "string" && COST.test(payload.observed_value_usd) },
  "ai.cost_alert.acknowledged": { source: "ai", keys: ["alert_id"], required: ["alert_id"], valid: (payload) => uuid(payload.alert_id) },
  "notification.delivery.failed": { source: "ai", keys: ["delivery_id", "alert_id", "channel", "error_code"], required: ["delivery_id", "alert_id", "channel", "error_code"], valid: (payload) => uuid(payload.delivery_id) && uuid(payload.alert_id) && (payload.channel === "ui" || payload.channel === "email") && text(payload.error_code, 80) },
};

function aiRun(payload: Record<string, unknown>, status: string): boolean {
  return uuid(payload.run_id) && uuid(payload.conversation_id) && typeof payload.model === "string" && payload.status === status && typeof payload.usage_complete === "boolean" && (payload.estimated_cost_usd === undefined || payload.estimated_cost_usd === null || (typeof payload.estimated_cost_usd === "string" && COST.test(payload.estimated_cost_usd)));
}

function uuid(value: unknown): boolean {
  return typeof value === "string" && UUID.test(value);
}

function text(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

function instant(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}
