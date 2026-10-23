import { acceptEnvelope } from "./envelope";
import { handleDelivery } from "./delivery";
import { AUDIT_ERROR_CODES, AuditError, httpStatusFor } from "./audit-error";
import { parsePageQuery } from "./pagination";
import { assertRange } from "./range";

const id = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const correlation = "33333333-3333-4333-8333-333333333333";
const product = "44444444-4444-4444-8444-444444444444";

function envelope(payload: unknown, eventType = "product.changed", source = "catalog") {
  return JSON.stringify({
    event_id: id,
    event_type: eventType,
    schema_version: 1,
    occurred_at: "2026-10-21T18:00:00.000Z",
    source_service: source,
    actor_type: "user",
    actor_id: actor,
    correlation_id: correlation,
    causation_id: null,
    payload,
  });
}

describe("audit envelope", () => {
  it("accepts a catalog change and drops a secret that is not part of the contract", () => {
    expect(acceptEnvelope(envelope({ product_id: product, change: "updated", password: "no-guardar" }), "2026-10-21T18:01:00.000Z").ok).toBe(false);
    const accepted = acceptEnvelope(envelope({ product_id: product, change: "updated" }), "2026-10-21T18:01:00.000Z");
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.record.metadata.password).toBeUndefined();
      expect(accepted.record.resourceId).toBe(product);
    }
  });

  it("redacts a token stored in an allowed field and rejects a bad contract", () => {
    const session = "88888888-8888-4888-8888-888888888888";
    const tokenized = acceptEnvelope(envelope({
      session_id: session,
      user_id: actor,
      reason: "eyJhbGciOiJIUzI1NiJ9.aaa.bbb",
    }, "session.revoked", "access"), "2026-10-21T18:00:00.000Z");
    expect(tokenized.ok && tokenized.record.changes.some((change) => change.field === "reason")).toBe(true);
    expect(tokenized.ok && tokenized.record.metadata.reason).toBeUndefined();
    expect(tokenized.ok && tokenized.record.reasonCode).toBeNull();
    expect(acceptEnvelope("{", "2026-10-21T18:00:00.000Z").ok).toBe(false);
    expect(acceptEnvelope(envelope({ product_id: product, change: "updated" }, "audit.query", "catalog"), "2026-10-21T18:00:00.000Z").ok).toBe(false);
    expect(acceptEnvelope(envelope({ product_id: product, change: "no" }), "2026-10-21T18:00:00.000Z").ok).toBe(false);
    expect(acceptEnvelope(envelope({ transfer_id: product, reference: "TRF1", source_account_id: actor, destination_account_id: correlation, amount: "10.00", currency: "MXN" }, "transfer.completed", "accounts"), "2026-10-21T18:00:00.000Z").ok).toBe(true);
    expect(acceptEnvelope(envelope({ proposal_id: product, reason_code: "insufficient_funds" }, "transfer.rejected", "accounts"), "2026-10-21T18:00:00.000Z").ok).toBe(true);
    expect(acceptEnvelope(envelope({ user_id: actor }, "user.deleted", "access"), "2026-10-21T18:00:00.000Z").ok).toBe(true);
    expect(acceptEnvelope("[]", "2026-10-21T18:00:00.000Z").ok).toBe(false);
  });

  it("acks a duplicate, retries a fallen store and dead-letters poison", async () => {
    const seen: string[] = [];
    const store = {
      insert: async (record: { eventId: string }) => {
        if (seen.includes(record.eventId)) {
          return "duplicate" as const;
        }
        seen.push(record.eventId);
        return "inserted" as const;
      },
    };
    const raw = envelope({ offer_id: product, change: "created" }, "offer.changed");
    expect(await handleDelivery(raw, store, 3, false, "2026-10-21T18:00:00.000Z")).toBe("ack");
    expect(await handleDelivery(raw, store, 3, false, "2026-10-21T18:00:00.000Z")).toBe("ack");
    expect(seen).toHaveLength(1);
    let failures = 0;
    const down = {
      insert: async () => {
        failures += 1;
        throw new Error("mongo_down");
      },
    };
    expect(await handleDelivery(raw, down, 3, false, "2026-10-21T18:00:00.000Z")).toBe("dead");
    expect(failures).toBe(3);
    expect(await handleDelivery(raw, down, 3, true, "2026-10-21T18:00:00.000Z")).toBe("dead");
    expect(await handleDelivery("{}", store, 3, false, "2026-10-21T18:00:00.000Z")).toBe("dead");
  });

  it("bounds the consultation range and the page", () => {
    const now = new Date("2026-10-21T18:00:00.000Z");
    const range = assertRange({ now, maxDays: 31 });
    expect(Date.parse(range.to) - Date.parse(range.from)).toBe(31 * 86_400_000);
    expect(() => assertRange({ from: "2026-01-01T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z", now, maxDays: 31 })).toThrow(AuditError);
    expect(() => assertRange({ from: "ayer", now, maxDays: 31 })).toThrow(AuditError);
    expect(() => assertRange({ from: "2026-10-22T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z", now, maxDays: 31 })).toThrow(AuditError);
    expect(parsePageQuery({ pageDefault: 20, pageMax: 100, sort: "createdAt" }).sort).toBe("createdAt");
    expect(() => parsePageQuery({ page: "0", pageDefault: 20, pageMax: 100 })).toThrow(AuditError);
    expect(() => parsePageQuery({ pageSize: "101", pageDefault: 20, pageMax: 100 })).toThrow(AuditError);
    expect(() => parsePageQuery({ sort: "name", pageDefault: 20, pageMax: 100 })).toThrow(AuditError);
    expect(new Set(AUDIT_ERROR_CODES.map((code) => httpStatusFor(code)))).toEqual(new Set([401, 403, 404, 409, 422, 503]));
  });
});
