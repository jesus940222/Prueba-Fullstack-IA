import { publishPending } from "./outbox";
import { MemoryAccountsStore } from "./testing/memory-store";

describe("outbox publication", () => {
  it("leaves the event unpublished when the broker fails", async () => {
    const store = new MemoryAccountsStore();
    store.outbox.push({
      id: "00000000-0000-4000-8000-000000000010",
      eventType: "transfer.completed",
      aggregateId: "00000000-0000-4000-8000-000000000011",
      actorId: "00000000-0000-4000-8000-000000000001",
      correlationId: "00000000-0000-4000-8000-000000000012",
      payload: { transfer_id: "00000000-0000-4000-8000-000000000011", reference: "TRF1", source_account_id: "00000000-0000-4000-8000-0000000000a1", destination_account_id: "00000000-0000-4000-8000-0000000000a2", amount: "1.00", currency: "MXN" },
      occurredAt: "2026-10-22T18:00:00.000Z",
      publishedAt: null,
      attemptCount: 0,
    });
    await expect(publishPending(store, { async publish() { throw new Error("down"); } }, 10, "2026-10-22T18:01:00.000Z")).rejects.toThrow("down");
    expect(store.outbox[0]?.publishedAt).toBeNull();
  });
});
