import { pageByCursor, type BeneficiaryCursor } from "../../domain/cursor";
import { movementBalance } from "../../domain/spend";
import { decideTransfer } from "../../domain/transfer-policy";
import type { PageQuery } from "../../domain/pagination";
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
} from "../../domain/records";
import type { AccountsStore, ConfirmCommand, ConfirmResult, MovementFilter, ResolvedAccount } from "../ports";

export class MemoryAccountsStore implements AccountsStore {
  customers: CustomerRecord[] = [];
  links: Array<{ userId: string; customerId: string }> = [];
  accounts: AccountRecord[] = [];
  movements: MovementRecord[] = [];
  beneficiaries: BeneficiaryRecord[] = [];
  limits: LimitsRecord[] = [];
  proposals: ProposalRecord[] = [];
  transfers: TransferRecord[] = [];
  idempotency: IdempotencyRecord[] = [];
  outbox: OutboxRecord[] = [];
  usage = new Map<string, string>();
  resolves: Array<{ userId: string; at: string }> = [];
  private chain: Promise<void> = Promise.resolve();

  async customerForUser(userId: string): Promise<CustomerRecord | null> {
    const link = this.links.find((item) => item.userId === userId);
    return this.customers.find((item) => item.id === link?.customerId) ?? null;
  }

  async customerById(customerId: string): Promise<CustomerRecord | null> {
    return this.customers.find((item) => item.id === customerId) ?? null;
  }

  async accountsOf(customerId: string): Promise<AccountRecord[]> {
    return this.owned(customerId);
  }

  async listAccounts(customerId: string, query: PageQuery) {
    const items = this.owned(customerId).slice().sort((left, right) => this.byTime(left, right, query.sort));
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), totalItems: items.length };
  }

  async findAccount(accountId: string) {
    return this.accounts.find((item) => item.id === accountId) ?? null;
  }

  async listMovements(accountId: string, query: PageQuery, filter: MovementFilter) {
    const items = this.movements
      .filter((item) => item.accountId === accountId)
      .filter((item) => !filter.direction || item.direction === filter.direction)
      .filter((item) => !filter.from || item.recordedAt >= filter.from)
      .filter((item) => !filter.to || item.recordedAt < filter.to)
      .sort((left, right) => this.byMovement(left, right, query.sort));
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), totalItems: items.length };
  }

  async movementsForCustomer(customerId: string) {
    const ids = new Set(this.owned(customerId).map((item) => item.id));
    return this.movements.filter((item) => ids.has(item.accountId));
  }

  async listBeneficiaries(customerId: string, search: string, cursor: BeneficiaryCursor | null, limit: number) {
    const active = this.beneficiaries.filter((item) => item.customerId === customerId && item.status === "active");
    return pageByCursor(active, search, cursor, limit);
  }

  async findBeneficiary(customerId: string, beneficiaryId: string) {
    return this.beneficiaries.find((item) => item.id === beneficiaryId && item.customerId === customerId && item.status === "active") ?? null;
  }

  async findActiveBeneficiary(customerId: string, destinationAccountId: string) {
    return this.beneficiaries.find((item) => item.customerId === customerId && item.destinationAccountId === destinationAccountId && item.status === "active") ?? null;
  }

  async saveBeneficiary(beneficiary: BeneficiaryRecord, event: OutboxRecord) {
    this.beneficiaries.push(beneficiary);
    this.outbox.push(event);
  }

  async renameBeneficiary(customerId: string, beneficiaryId: string, alias: string, event: OutboxRecord) {
    const found = await this.findBeneficiary(customerId, beneficiaryId);
    if (!found) {
      return null;
    }
    found.alias = alias;
    this.outbox.push(event);
    return found;
  }

  async deleteBeneficiary(customerId: string, beneficiaryId: string, at: string, event: OutboxRecord) {
    const found = await this.findBeneficiary(customerId, beneficiaryId);
    if (!found) {
      return false;
    }
    found.status = "deleted";
    void at;
    this.outbox.push(event);
    return true;
  }

  async findByAccountNumber(accountNumber: string): Promise<ResolvedAccount | null> {
    const account = this.accounts.find((item) => item.accountNumber === accountNumber) ?? null;
    if (!account) {
      return null;
    }
    const holder = this.customers.find((item) => item.id === account.customerId);
    return { ...account, holderGivenName: holder?.givenName ?? "", holderFamilyName: holder?.familyName ?? "" };
  }

  async countResolves(userId: string, since: string) {
    return this.resolves.filter((item) => item.userId === userId && item.at >= since).length;
  }

  async recordResolve(id: string, userId: string, at: string) {
    void id;
    this.resolves.push({ userId, at });
  }

  async saveProposal(proposal: ProposalRecord) {
    this.proposals.push(proposal);
  }

  async findProposal(proposalId: string) {
    return this.proposals.find((item) => item.id === proposalId) ?? null;
  }

  async cancelProposal(proposalId: string, userId: string, sessionId: string, now: string) {
    const proposal = await this.findProposal(proposalId);
    if (!proposal || proposal.userId !== userId || proposal.sessionId !== sessionId) {
      return "missing";
    }
    if (proposal.status !== "pending" || Date.parse(proposal.expiresAt) <= Date.parse(now)) {
      return "closed";
    }
    proposal.status = "cancelled";
    return "cancelled";
  }

  async limitsFor(userId: string) {
    return this.limits.find((item) => item.userId === userId) ?? null;
  }

  async saveLimits(limits: LimitsRecord, event: OutboxRecord) {
    const index = this.limits.findIndex((item) => item.userId === limits.userId);
    if (index >= 0) {
      this.limits[index] = limits;
    } else {
      this.limits.push(limits);
    }
    this.outbox.push(event);
  }

  async consumedOn(userId: string, dayKey: string) {
    return this.usage.get(`${userId}:${dayKey}`) ?? "0.00";
  }

  async confirm(command: ConfirmCommand): Promise<ConfirmResult> {
    return this.exclusive(async () => {
      const proposal = await this.findProposal(command.proposalId);
      if (!proposal) {
        return { kind: "hidden" };
      }
      const source = this.accounts.find((item) => item.id === proposal.sourceAccountId) ?? null;
      const destination = this.accounts.find((item) => item.id === proposal.destinationAccountId) ?? null;
      const idempotency = this.idempotency.find((item) => item.userId === command.principal.userId && item.idempotencyKey === command.idempotencyKey) ?? null;
      const existing = this.transfers.find((item) => item.proposalId === proposal.id) ?? null;
      await command.reauthorize();
      const decision = decideTransfer({
        proposal,
        source,
        destination,
        ownerCustomerId: command.ownerCustomerId,
        actorUserId: command.principal.userId,
        actorSessionId: command.principal.sessionId,
        perTransferLimit: command.perTransferLimit,
        dailyLimit: command.dailyLimit,
        consumedToday: await this.consumedOn(command.principal.userId, command.dayKey),
        now: new Date(command.now),
        requestHash: command.requestHash,
        idempotency,
        existingTransferId: existing?.id ?? null,
      });
      if (decision.kind === "hidden" || decision.kind === "conflict") {
        return decision;
      }
      if (decision.kind === "replay") {
        const transfer = this.transfers.find((item) => item.id === decision.transferId);
        if (!transfer) {
          return { kind: "hidden" };
        }
        return { kind: "completed", transfer };
      }
      if (decision.kind === "reject") {
        if (!decision.alreadyRecorded) {
          proposal.status = decision.status;
          proposal.rejectionReason = decision.reason;
          this.idempotency.push({
            id: command.idempotencyId,
            userId: command.principal.userId,
            operation: "transfer.confirm",
            idempotencyKey: command.idempotencyKey,
            requestHash: command.requestHash,
            transferId: null,
            status: "rejected",
            reasonCode: decision.reason,
          });
          this.outbox.push(this.rejectedEvent(command, proposal.id, decision.reason));
        }
        return { kind: "rejected", reason: decision.reason };
      }
      if (!source || !destination) {
        return { kind: "hidden" };
      }
      source.balance = decision.sourceBalance;
      destination.balance = decision.destinationBalance;
      this.usage.set(`${command.principal.userId}:${command.dayKey}`, decision.consumed);
      const transfer: TransferRecord = {
        id: command.transferId,
        reference: command.reference,
        proposalId: proposal.id,
        initiatedBy: command.principal.userId,
        sourceAccountId: source.id,
        destinationAccountId: destination.id,
        destinationLabel: proposal.destinationLabel,
        amount: proposal.amount,
        currency: "MXN",
        concept: proposal.concept,
        status: "completed",
        completedAt: command.now,
      };
      this.transfers.push(transfer);
      this.movements.push(this.movement(command.debitMovementId, source.id, transfer.id, "out", proposal.amount, decision.sourceBalance, command.now));
      this.movements.push(this.movement(command.creditMovementId, destination.id, transfer.id, "in", proposal.amount, decision.destinationBalance, command.now));
      proposal.status = "confirmed";
      proposal.confirmedAt = command.now;
      this.idempotency.push({
        id: command.idempotencyId,
        userId: command.principal.userId,
        operation: "transfer.confirm",
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
        transferId: transfer.id,
        status: "completed",
        reasonCode: null,
      });
      this.outbox.push({
        id: command.outboxId,
        eventType: "transfer.completed",
        aggregateId: transfer.id,
        actorId: command.principal.userId,
        correlationId: command.correlationId,
        occurredAt: command.now,
        publishedAt: null,
        attemptCount: 0,
        payload: {
          transfer_id: transfer.id,
          reference: transfer.reference,
          source_account_id: source.id,
          destination_account_id: destination.id,
          amount: proposal.amount,
          currency: "MXN",
        },
      });
      if (movementBalance(this.movements.filter((item) => item.accountId === source.id)) !== source.balance) {
        throw new Error("balance_mismatch");
      }
      return { kind: "completed", transfer };
    });
  }

  async listTransfers(customerId: string, query: PageQuery) {
    const ids = new Set(this.owned(customerId).map((item) => item.id));
    const items = this.transfers
      .filter((item) => ids.has(item.sourceAccountId) || ids.has(item.destinationAccountId))
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.id.localeCompare(right.id));
    if (query.sort === "-createdAt") {
      items.reverse();
    }
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), totalItems: items.length };
  }

  async findTransfer(transferId: string) {
    return this.transfers.find((item) => item.id === transferId) ?? null;
  }

  async oldestAccountAt(customerId: string) {
    const dates = this.owned(customerId).map((item) => item.createdAt).sort();
    return dates[0] ?? null;
  }

  async unpublishedOutbox(limit: number) {
    return this.outbox.filter((item) => item.publishedAt === null).slice(0, limit);
  }

  async markOutboxPublished(ids: readonly string[], at: string) {
    for (const event of this.outbox) {
      if (ids.includes(event.id)) {
        event.publishedAt = at;
      }
    }
  }

  async idempotencyFor(userId: string, key: string) {
    return this.idempotency.find((item) => item.userId === userId && item.idempotencyKey === key) ?? null;
  }

  private owned(customerId: string) {
    return this.accounts.filter((item) => item.customerId === customerId);
  }

  private byTime(left: AccountRecord, right: AccountRecord, sort: PageQuery["sort"]) {
    const compared = left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
    return sort === "createdAt" ? compared : -compared;
  }

  private byMovement(left: MovementRecord, right: MovementRecord, sort: PageQuery["sort"]) {
    const compared = left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id);
    return sort === "createdAt" ? compared : -compared;
  }

  private movement(id: string, accountId: string, transferId: string, direction: "in" | "out", amount: string, balanceAfter: string, recordedAt: string): MovementRecord {
    return { id, accountId, transferId, type: "transfer", direction, amount, currency: "MXN", balanceAfter, recordedAt };
  }

  private rejectedEvent(command: ConfirmCommand, proposalId: string, reason: string): OutboxRecord {
    return {
      id: command.outboxId,
      eventType: "transfer.rejected",
      aggregateId: proposalId,
      actorId: command.principal.userId,
      correlationId: command.correlationId,
      occurredAt: command.now,
      publishedAt: null,
      attemptCount: 0,
      payload: { proposal_id: proposalId, reason_code: reason },
    };
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }
}
