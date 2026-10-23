export interface OutboxDraft {
  eventType: "session.revoked" | "user.deleted" | "role.updated" | "role.assignment.changed";
  aggregateId: string;
  payload: Record<string, string | number>;
}

const SECRET_KEYS = ["password", "token", "code", "secret", "otp", "credential"];

export function assertOutboxPayload(draft: OutboxDraft): OutboxDraft {
  for (const key of Object.keys(draft.payload)) {
    if (SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret))) {
      throw new Error("outbox_secret");
    }
  }
  return draft;
}

export function sessionRevoked(sessionId: string, userId: string, reason: string): OutboxDraft {
  return assertOutboxPayload({
    eventType: "session.revoked",
    aggregateId: sessionId,
    payload: { session_id: sessionId, user_id: userId, reason: reason.slice(0, 80) },
  });
}

export function userDeleted(userId: string): OutboxDraft {
  return assertOutboxPayload({
    eventType: "user.deleted",
    aggregateId: userId,
    payload: { user_id: userId },
  });
}

export function roleUpdated(roleId: string, authorizationVersion: number): OutboxDraft {
  return assertOutboxPayload({
    eventType: "role.updated",
    aggregateId: roleId,
    payload: { role_id: roleId, authorization_version: authorizationVersion },
  });
}

export function assignmentChanged(userId: string, roleId: string, assignmentId: string, change: "assigned" | "revoked"): OutboxDraft {
  return assertOutboxPayload({
    eventType: "role.assignment.changed",
    aggregateId: assignmentId,
    payload: { user_id: userId, role_id: roleId, assignment_id: assignmentId, change },
  });
}
