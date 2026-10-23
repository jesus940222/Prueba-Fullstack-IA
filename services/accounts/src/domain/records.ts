export type AccountStatus = "active" | "closed";
export type ProposalStatus = "pending" | "confirmed" | "cancelled" | "rejected" | "expired";
export type MovementDirection = "in" | "out";
export type MovementType = "opening" | "transfer" | "purchase";

export interface CustomerRecord {
  id: string;
  customerNumber: string;
  givenName: string;
  familyName: string;
  status: "active" | "disabled";
}

export interface AccountRecord {
  id: string;
  customerId: string;
  accountNumber: string;
  name: string;
  currency: "MXN";
  status: AccountStatus;
  balance: string;
  closedAt: string | null;
  createdAt: string;
}

export interface MovementRecord {
  id: string;
  accountId: string;
  transferId: string | null;
  type: MovementType;
  direction: MovementDirection;
  amount: string;
  currency: "MXN";
  balanceAfter: string;
  recordedAt: string;
}

export interface BeneficiaryRecord {
  id: string;
  customerId: string;
  destinationAccountId: string;
  alias: string;
  status: "active" | "deleted";
  createdAt: string;
}

export interface LimitsRecord {
  userId: string;
  currency: "MXN";
  perTransferLimit: string;
  dailyLimit: string;
}

export interface ProposalRecord {
  id: string;
  userId: string;
  sessionId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  destinationLabel: string;
  amount: string;
  currency: "MXN";
  concept: string;
  status: ProposalStatus;
  expiresAt: string;
  confirmedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface TransferRecord {
  id: string;
  reference: string;
  proposalId: string;
  initiatedBy: string;
  sourceAccountId: string;
  destinationAccountId: string;
  destinationLabel: string;
  amount: string;
  currency: "MXN";
  concept: string;
  status: "completed";
  completedAt: string;
}

export interface OutboxRecord {
  id: string;
  eventType: string;
  aggregateId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  publishedAt: string | null;
  attemptCount: number;
}

export interface IdempotencyRecord {
  id: string;
  userId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  transferId: string | null;
  status: "completed" | "rejected";
  reasonCode: string | null;
}
