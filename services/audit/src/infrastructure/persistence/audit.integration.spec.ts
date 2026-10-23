import mongoose from "mongoose";
import { acceptEnvelope } from "../../domain/envelope";
import { handleDelivery } from "../../domain/delivery";
import { MongoAuditStore } from "./mongo-audit-store";

const gateUrl = process.env.AUDIT_GATE_MONGO_URL ?? "";
const gate = gateUrl === "" ? describe.skip : describe;
const eventId = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const correlation = "33333333-3333-4333-8333-333333333333";
const product = "44444444-4444-4444-8444-444444444444";

function raw(id = eventId) {
  return JSON.stringify({
    event_id: id,
    event_type: "product.changed",
    schema_version: 1,
    occurred_at: "2026-10-21T18:00:00.000Z",
    source_service: "catalog",
    actor_type: "user",
    actor_id: actor,
    correlation_id: correlation,
    causation_id: null,
    payload: { product_id: product, change: "updated" },
  });
}

gate("audit append and deduplication", () => {
  const connection = mongoose.createConnection();

  beforeAll(async () => {
    await connection.openUri(gateUrl, { serverSelectionTimeoutMS: 5000 });
    const events = connection.collection("events");
    await events.createIndex({ event_id: 1 }, { unique: true, name: "event_id_unique" });
    await events.deleteMany({});
  });

  afterAll(async () => {
    await connection.close();
  });

  it("stores one document for a duplicate and keeps it when a later insert fails", async () => {
    const store = new MongoAuditStore(connection.collection("events"));
    expect(await handleDelivery(raw(), store, 2, false, "2026-10-21T18:01:00.000Z")).toBe("ack");
    expect(await handleDelivery(raw(), store, 2, false, "2026-10-21T18:01:00.000Z")).toBe("ack");
    expect(await connection.collection("events").countDocuments({ event_id: eventId })).toBe(1);
    const accepted = acceptEnvelope(raw("99999999-9999-4999-8999-999999999999"), "2026-10-21T18:01:00.000Z");
    if (!accepted.ok) {
      throw new Error("envelope");
    }
    await connection.close();
    await expect(store.insert(accepted.record)).rejects.toThrow();
    await connection.openUri(gateUrl, { serverSelectionTimeoutMS: 5000 });
    expect(await connection.collection("events").countDocuments({ event_id: eventId })).toBe(1);
  });
});
