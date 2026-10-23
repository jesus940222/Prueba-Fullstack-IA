export const EVENT_TYPES = [
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

export type EventType = (typeof EVENT_TYPES)[number];
