import type { PageQuery } from "../domain/pagination";
import type { BeneficiaryCursor } from "../domain/cursor";
import type {
  AccountRecord,
  BeneficiaryRecord,
  CustomerRecord,
  IdempotencyRecord,
  LimitsRecord,
  MovementRecord,
  OutboxRecord,
  ProposalRecord,
  TransferRecord,
} from "../domain/records";

export interface Principal {
  userId: string;
  sessionId: string;
}

export interface Authorizer {
  authorize(sessionToken: string, permission: string, requireRecentVerification: boolean): Promise<Principal>;
}

export interface Clock {
  now(): Date;
}

export interface Ids {
  uuid(): string;
}

export interface MovementFilter {
  direction?: "in" | "out";
  from?: string;
  to?: string;
}

export interface ConfirmCommand {
  principal: Principal;
  ownerCustomerId: string;
  proposalId: string;
  idempotencyKey: string;
  requestHash: string;
  perTransferLimit: string;
  dailyLimit: string;
  dayKey: string;
  now: string;
  transferId: string;
  reference: string;
  debitMovementId: string;
  creditMovementId: string;
  outboxId: string;
  idempotencyId: string;
  correlationId: string;
  reauthorize: () => Promise<Principal>;
}

export type ConfirmResult =
  | { kind: "completed"; transfer: TransferRecord }
  | { kind: "rejected"; reason: string }
  | { kind: "hidden" }
  | { kind: "conflict"; code: "CONFLICT" | "IDEMPOTENCY_CONFLICT" };

export interface ResolvedAccount extends AccountRecord {
  holderGivenName: string;
  holderFamilyName: string;
}

export interface AccountsStore {
  customerForUser(userId: string): Promise<CustomerRecord | null>;
  customerById(customerId: string): Promise<CustomerRecord | null>;
  accountsOf(customerId: string): Promise<AccountRecord[]>;
  listAccounts(customerId: string, query: PageQuery): Promise<{ items: AccountRecord[]; totalItems: number }>;
  findAccount(accountId: string): Promise<AccountRecord | null>;
  listMovements(accountId: string, query: PageQuery, filter: MovementFilter): Promise<{ items: MovementRecord[]; totalItems: number }>;
  movementsForCustomer(customerId: string): Promise<MovementRecord[]>;
  listBeneficiaries(customerId: string, search: string, cursor: BeneficiaryCursor | null, limit: number): Promise<{ items: BeneficiaryRecord[]; nextCursor: string | null; hasMore: boolean }>;
  findBeneficiary(customerId: string, beneficiaryId: string): Promise<BeneficiaryRecord | null>;
  findActiveBeneficiary(customerId: string, destinationAccountId: string): Promise<BeneficiaryRecord | null>;
  saveBeneficiary(beneficiary: BeneficiaryRecord, event: OutboxRecord): Promise<void>;
  renameBeneficiary(customerId: string, beneficiaryId: string, alias: string, event: OutboxRecord): Promise<BeneficiaryRecord | null>;
  deleteBeneficiary(customerId: string, beneficiaryId: string, at: string, event: OutboxRecord): Promise<boolean>;
  findByAccountNumber(accountNumber: string): Promise<ResolvedAccount | null>;
  countResolves(userId: string, since: string): Promise<number>;
  recordResolve(id: string, userId: string, at: string): Promise<void>;
  saveProposal(proposal: ProposalRecord): Promise<void>;
  findProposal(proposalId: string): Promise<ProposalRecord | null>;
  cancelProposal(proposalId: string, userId: string, sessionId: string, now: string): Promise<"cancelled" | "missing" | "closed">;
  limitsFor(userId: string): Promise<LimitsRecord | null>;
  saveLimits(limits: LimitsRecord, event: OutboxRecord): Promise<void>;
  consumedOn(userId: string, dayKey: string): Promise<string>;
  confirm(command: ConfirmCommand): Promise<ConfirmResult>;
  listTransfers(customerId: string, query: PageQuery): Promise<{ items: TransferRecord[]; totalItems: number }>;
  findTransfer(transferId: string): Promise<TransferRecord | null>;
  oldestAccountAt(customerId: string): Promise<string | null>;
  unpublishedOutbox(limit: number): Promise<OutboxRecord[]>;
  markOutboxPublished(ids: readonly string[], at: string): Promise<void>;
  idempotencyFor(userId: string, key: string): Promise<IdempotencyRecord | null>;
}

export interface EventBroker {
  publish(events: readonly OutboxRecord[]): Promise<void>;
}
