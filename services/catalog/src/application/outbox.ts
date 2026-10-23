import type { CatalogStore, EventBroker } from "./ports";

export async function publishPending(store: CatalogStore, broker: EventBroker, limit: number, now: string): Promise<number> {
  const pending = await store.unpublishedOutbox(limit);
  if (pending.length === 0) {
    return 0;
  }
  await broker.publish(pending);
  await store.markOutboxPublished(pending.map((event) => event.id), now);
  return pending.length;
}
