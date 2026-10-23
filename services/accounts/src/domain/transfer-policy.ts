import { AccountsError } from "./accounts-error";
import { Money } from "./money";
import type { ProposalStatus } from "./records";

export interface AccountSnapshot {
  id: string;
  customerId: string;
  status: "active" | "closed";
  currency: "MXN";
  balance: string;
}

export interface ProposalSnapshot {
  id: string;
  userId: string;
  sessionId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: string;
  currency: "MXN";
  status: ProposalStatus;
  expiresAt: string;
  rejectionReason: string | null;
}

export type TransferDecision =
  | { kind: "replay"; transferId: string }
  | { kind: "conflict"; code: "CONFLICT" | "IDEMPOTENCY_CONFLICT" }
  | { kind: "hidden" }
  | { kind: "reject"; status: "rejected" | "expired" | "cancelled"; reason: string; alreadyRecorded: boolean }
  | { kind: "post"; sourceBalance: string; destinationBalance: string; consumed: string };

export function decideTransfer(input: {
  proposal: ProposalSnapshot;
  source: AccountSnapshot | null;
  destination: AccountSnapshot | null;
  ownerCustomerId: string;
  actorUserId: string;
  actorSessionId: string;
  perTransferLimit: string;
  dailyLimit: string;
  consumedToday: string;
  now: Date;
  requestHash: string;
  idempotency: { requestHash: string; transferId: string | null; status: "completed" | "rejected"; reasonCode: string | null } | null;
  existingTransferId: string | null;
}): TransferDecision {
  if (input.idempotency && input.idempotency.requestHash !== input.requestHash) {
    return { kind: "conflict", code: "IDEMPOTENCY_CONFLICT" };
  }
  if (input.idempotency?.transferId) {
    return { kind: "replay", transferId: input.idempotency.transferId };
  }
  if (input.idempotency?.status === "rejected") {
    return {
      kind: "reject",
      status: "rejected",
      reason: input.idempotency.reasonCode ?? "rejected",
      alreadyRecorded: true,
    };
  }
  if (input.proposal.userId !== input.actorUserId || input.proposal.sessionId !== input.actorSessionId) {
    return { kind: "hidden" };
  }
  if (input.proposal.status === "confirmed" || input.existingTransferId) {
    return { kind: "conflict", code: "CONFLICT" };
  }
  if (input.proposal.status === "cancelled") {
    return { kind: "reject", status: "cancelled", reason: "proposal_cancelled", alreadyRecorded: true };
  }
  if (input.proposal.status === "rejected" || input.proposal.status === "expired") {
    return { kind: "reject", status: input.proposal.status, reason: input.proposal.rejectionReason ?? input.proposal.status, alreadyRecorded: true };
  }
  if (Date.parse(input.proposal.expiresAt) <= input.now.getTime()) {
    return { kind: "reject", status: "expired", reason: "proposal_expired", alreadyRecorded: false };
  }
  if (!input.source || input.source.customerId !== input.ownerCustomerId) {
    return { kind: "hidden" };
  }
  if (!input.destination || input.destination.status !== "active" || input.source.status !== "active") {
    return { kind: "reject", status: "rejected", reason: "account_unavailable", alreadyRecorded: false };
  }
  if (input.source.id === input.destination.id) {
    return { kind: "reject", status: "rejected", reason: "same_account", alreadyRecorded: false };
  }
  if (input.source.currency !== "MXN" || input.destination.currency !== "MXN" || input.proposal.currency !== "MXN") {
    return { kind: "reject", status: "rejected", reason: "currency", alreadyRecorded: false };
  }
  const amount = Money.parse(input.proposal.amount);
  if (!amount.isPositive()) {
    return { kind: "reject", status: "rejected", reason: "amount", alreadyRecorded: false };
  }
  const perTransfer = Money.parse(input.perTransferLimit);
  const daily = Money.parse(input.dailyLimit);
  const consumed = Money.parse(input.consumedToday);
  const balance = Money.parse(input.source.balance);
  if (amount.greaterThan(perTransfer)) {
    return { kind: "reject", status: "rejected", reason: "per_transfer_limit", alreadyRecorded: false };
  }
  const nextConsumed = consumed.add(amount);
  if (nextConsumed.greaterThan(daily)) {
    return { kind: "reject", status: "rejected", reason: "daily_limit", alreadyRecorded: false };
  }
  if (amount.greaterThan(balance)) {
    return { kind: "reject", status: "rejected", reason: "insufficient_funds", alreadyRecorded: false };
  }
  return {
    kind: "post",
    sourceBalance: balance.subtract(amount).format(),
    destinationBalance: Money.parse(input.destination.balance).add(amount).format(),
    consumed: nextConsumed.format(),
  };
}

export function assertPersonalLimits(input: {
  perTransferLimit: string;
  dailyLimit: string;
  perTransferMax: string;
  dailyMax: string;
}): void {
  const perTransfer = Money.parse(input.perTransferLimit);
  const daily = Money.parse(input.dailyLimit);
  const perTransferMax = Money.parse(input.perTransferMax);
  const dailyMax = Money.parse(input.dailyMax);
  if (!perTransfer.isPositive() || !daily.isPositive() || perTransfer.greaterThan(daily) || perTransfer.greaterThan(perTransferMax) || daily.greaterThan(dailyMax)) {
    throw new AccountsError("BUSINESS_RULE", "Los límites quedan fuera del máximo permitido");
  }
}

export function maskedAccount(accountNumber: string): string {
  const tail = accountNumber.slice(-4);
  return `${"*".repeat(Math.max(accountNumber.length - 4, 0))}${tail}`;
}

export function holderLabel(givenName: string, familyName: string): string {
  const initial = familyName.trim().slice(0, 1);
  const label = initial === "" ? givenName : `${givenName} ${initial}.`;
  return label.slice(0, 40);
}

export function proposalVisibleStatus(status: ProposalStatus, expiresAt: string, now: Date): ProposalStatus {
  if (status === "pending" && Date.parse(expiresAt) <= now.getTime()) {
    return "expired";
  }
  return status;
}
