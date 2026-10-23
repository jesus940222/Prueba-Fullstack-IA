import { AuditError } from "../domain/audit-error";
import { acceptEnvelope } from "../domain/envelope";
import { handleDelivery } from "../domain/delivery";
import { AuditWorkflows } from "./audit-workflows";
import { MemoryAuditStore } from "./testing/memory-store";

const userId = "22222222-2222-4222-8222-222222222222";
const other = "55555555-5555-4555-8555-555555555555";
const correlation = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-10-21T18:00:00.000Z");
const page = { page: 1, pageSize: 20, sort: "-createdAt" as const };

function workflowsFor(store = new MemoryAuditStore(), permission = "audit:read:any") {
  let sequence = 70;
  return new AuditWorkflows(
    store,
    { authorize: async (_token, requested) => {
      if (requested !== permission) {
        throw new AuditError("PERMISSION_DENIED", "No tienes permiso para esta operación");
      }
      return { userId, sessionId: "66666666-6666-4666-8666-666666666666" };
    } },
    { now: () => now },
    { uuid: () => `77777777-7777-4777-8777-${(sequence += 1).toString(16).padStart(12, "0")}` },
    31,
  );
}

function raw(eventId: string, actorId = userId) {
  return JSON.stringify({
    event_id: eventId,
    event_type: "session.revoked",
    schema_version: 1,
    occurred_at: "2026-10-21T12:00:00.000Z",
    source_service: "access",
    actor_type: "user",
    actor_id: actorId,
    correlation_id: correlation,
    causation_id: null,
    payload: { session_id: "88888888-8888-4888-8888-888888888888", user_id: actorId, reason: "logout" },
  });
}

describe("audit workflows", () => {
  it("stores one row for a duplicate and records the query without a loop", async () => {
    const store = new MemoryAuditStore();
    const accepted = acceptEnvelope(raw("11111111-1111-4111-8111-111111111111"), now.toISOString());
    if (!accepted.ok) {
      throw new Error("envelope");
    }
    expect(await store.insert(accepted.record)).toBe("inserted");
    expect(await handleDelivery(raw("11111111-1111-4111-8111-111111111111"), store, 2, false, now.toISOString())).toBe("ack");
    expect(store.records.filter((record) => record.eventType === "session.revoked")).toHaveLength(1);
    const workflows = workflowsFor(store);
    const first = await workflows.list("token", { sourceService: "access" }, page, correlation);
    const second = await workflows.list("token", { eventType: "audit.query" }, page, correlation);
    expect(first.items.some((item) => item.eventType === "session.revoked")).toBe(true);
    expect(store.records.filter((record) => record.eventType === "audit.query")).toHaveLength(2);
    expect(second.totalItems).toBeGreaterThan(0);
  });

  it("hides another actor from the own query and denies a missing permission", async () => {
    const store = new MemoryAuditStore();
    const own = acceptEnvelope(raw("11111111-1111-4111-8111-111111111111"), now.toISOString());
    const foreign = acceptEnvelope(raw("99999999-9999-4999-8999-999999999999", other), now.toISOString());
    if (!own.ok || !foreign.ok) {
      throw new Error("envelope");
    }
    await store.insert(own.record);
    await store.insert(foreign.record);
    const workflows = workflowsFor(store, "audit:read:own");
    const pageResult = await workflows.listOwn("token", { actorId: other }, page, correlation);
    expect(pageResult.items.every((item) => item.actorId === userId || item.eventType === "audit.query")).toBe(true);
    expect(pageResult.items.some((item) => item.actorId === other && item.eventType !== "audit.query")).toBe(false);
    await expect(workflowsFor(store, "audit:read:own").list("token", {}, page, correlation)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const found = await workflowsFor(store).get("token", "11111111-1111-4111-8111-111111111111", correlation);
    expect(found.eventType).toBe("session.revoked");
    await expect(workflowsFor(store).get("token", "00000000-0000-4000-8000-000000000099", correlation)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
    const correlated = await workflowsFor(store).listCorrelation("token", correlation, page, correlation);
    expect(correlated.items.length).toBeGreaterThan(0);
  });
});
