import { AccountsError } from "../domain/accounts-error";
import { decodeCursor } from "../domain/cursor";
import { mexicoDay } from "../domain/mexico-day";
import { Money } from "../domain/money";
import type { PageQuery } from "../domain/pagination";
import type { AccountRecord, MovementRecord, ProposalRecord, TransferRecord } from "../domain/records";
import { commercialSpend } from "../domain/spend";
import { assertPersonalLimits, holderLabel, maskedAccount, proposalVisibleStatus } from "../domain/transfer-policy";
import { confirmRequestHash } from "./confirm-hash";
import type { AccountsStore, Authorizer, Clock, ConfirmResult, Ids, MovementFilter, Principal } from "./ports";

export interface AccountLimits {
  perTransferDefault: string;
  dailyDefault: string;
  perTransferMax: string;
  dailyMax: string;
  proposalTtlSeconds: number;
  resolveLimit: number;
  resolveWindowSeconds: number;
}

const REASONS: Record<string, string> = {
  insufficient_funds: "La cuenta no tiene saldo suficiente",
  daily_limit: "La operación supera el límite diario",
  per_transfer_limit: "La operación supera el límite por transferencia",
  proposal_expired: "La propuesta venció",
  account_unavailable: "La cuenta no está disponible",
  same_account: "El destino debe ser distinto del origen",
  amount: "El importe debe ser mayor que cero",
  proposal_cancelled: "La propuesta ya no está pendiente",
  rejected: "La transferencia no se pudo confirmar",
  expired: "La propuesta venció",
  currency: "Solo se transfiere en MXN",
};

export class AccountsWorkflows {
  constructor(
    private readonly store: AccountsStore,
    private readonly authorizer: Authorizer,
    private readonly clock: Clock,
    private readonly ids: Ids,
    private readonly limits: AccountLimits,
  ) {}

  async summary(sessionToken: string) {
    const principal = await this.principal(sessionToken, "accounts:read:own", false);
    const customer = await this.customer(principal.userId);
    const accounts = await this.store.accountsOf(customer.id);
    const total = accounts.filter((item) => item.status === "active").reduce((sum, item) => sum.add(Money.parse(item.balance)), Money.zero());
    const day = mexicoDay(this.clock.now());
    const movements = await this.store.movementsForCustomer(customer.id);
    const recent = movements
      .slice()
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || right.id.localeCompare(left.id))
      .slice(0, 5);
    return {
      totalBalance: total.format(),
      currency: "MXN" as const,
      spendTotal: commercialSpend(movements, day.key, (value) => mexicoDay(new Date(value)).key),
      recentMovements: recent.map(movementOf),
    };
  }

  async listAccounts(sessionToken: string, query: PageQuery) {
    const principal = await this.principal(sessionToken, "accounts:read:own", false);
    const customer = await this.customer(principal.userId);
    const page = await this.store.listAccounts(customer.id, query);
    return { ...page, items: page.items.map(accountOf) };
  }

  async getAccount(sessionToken: string, accountId: string) {
    const principal = await this.principal(sessionToken, "accounts:read:own", false);
    return accountOf(await this.ownAccount(principal.userId, accountId));
  }

  async listMovements(sessionToken: string, accountId: string, query: PageQuery, filter: MovementFilter) {
    const principal = await this.principal(sessionToken, "transactions:read:own", false);
    await this.ownAccount(principal.userId, accountId);
    const page = await this.store.listMovements(accountId, query, filter);
    return { ...page, items: page.items.map(movementOf) };
  }

  async listTransfers(sessionToken: string, query: PageQuery) {
    const principal = await this.principal(sessionToken, "transfers:read:own", false);
    const customer = await this.customer(principal.userId);
    const page = await this.store.listTransfers(customer.id, query);
    return { ...page, items: page.items.map(transferOf) };
  }

  async getTransfer(sessionToken: string, transferId: string) {
    const principal = await this.principal(sessionToken, "transfers:read:own", false);
    return transferOf(await this.visibleTransfer(principal.userId, transferId));
  }

  async receipt(sessionToken: string, transferId: string) {
    const principal = await this.principal(sessionToken, "transfers:read:own", false);
    const transfer = await this.visibleTransfer(principal.userId, transferId);
    if (transfer.status !== "completed") {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
    return {
      transferId: transfer.id,
      reference: transfer.reference,
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      destinationLabel: transfer.destinationLabel,
      amount: transfer.amount,
      currency: "MXN" as const,
      concept: transfer.concept,
      completedAt: transfer.completedAt,
    };
  }

  async listBeneficiaries(sessionToken: string, search: string, cursor: string | undefined, limit: number) {
    const principal = await this.principal(sessionToken, "beneficiaries:read:own", false);
    const customer = await this.customer(principal.userId);
    const page = await this.store.listBeneficiaries(customer.id, search, cursor ? decodeCursor(cursor, search) : null, limit);
    return { ...page, items: page.items.map(beneficiaryOf) };
  }

  async createBeneficiary(sessionToken: string, destinationAccountId: string, alias: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "beneficiaries:create:own", false);
    const customer = await this.customer(principal.userId);
    const destination = await this.store.findAccount(destinationAccountId);
    if (!destination || destination.status !== "active") {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El destinatario no está disponible");
    }
    if (await this.store.findActiveBeneficiary(customer.id, destination.id)) {
      throw new AccountsError("CONFLICT", "Ese beneficiario ya está guardado");
    }
    const now = this.clock.now().toISOString();
    const beneficiary = {
      id: this.ids.uuid(),
      customerId: customer.id,
      destinationAccountId: destination.id,
      alias,
      status: "active" as const,
      createdAt: now,
    };
    await this.store.saveBeneficiary(beneficiary, this.event(principal.userId, correlationId, "beneficiary.changed", beneficiary.id, {
      beneficiary_id: beneficiary.id,
      customer_id: customer.id,
      change: "created",
    }));
    return beneficiaryOf(beneficiary);
  }

  async renameBeneficiary(sessionToken: string, beneficiaryId: string, alias: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "beneficiaries:update:own", false);
    const customer = await this.customer(principal.userId);
    const updated = await this.store.renameBeneficiary(customer.id, beneficiaryId, alias, this.event(principal.userId, correlationId, "beneficiary.changed", beneficiaryId, {
      beneficiary_id: beneficiaryId,
      customer_id: customer.id,
      change: "updated",
    }));
    if (!updated) {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
    return beneficiaryOf(updated);
  }

  async deleteBeneficiary(sessionToken: string, beneficiaryId: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "beneficiaries:delete:own", false);
    const customer = await this.customer(principal.userId);
    const removed = await this.store.deleteBeneficiary(customer.id, beneficiaryId, this.clock.now().toISOString(), this.event(principal.userId, correlationId, "beneficiary.changed", beneficiaryId, {
      beneficiary_id: beneficiaryId,
      customer_id: customer.id,
      change: "deleted",
    }));
    if (!removed) {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
  }

  async resolveRecipient(sessionToken: string, accountNumber: string) {
    const principal = await this.principal(sessionToken, "transfers:create:own", false);
    await this.customer(principal.userId);
    const now = this.clock.now();
    const since = new Date(now.getTime() - this.limits.resolveWindowSeconds * 1000).toISOString();
    if (await this.store.countResolves(principal.userId, since) >= this.limits.resolveLimit) {
      throw new AccountsError("RATE_LIMITED", "Hay demasiados intentos de búsqueda");
    }
    await this.store.recordResolve(this.ids.uuid(), principal.userId, now.toISOString());
    const account = await this.store.findByAccountNumber(accountNumber);
    if (!account || account.status !== "active") {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El destinatario no está disponible");
    }
    return {
      destinationAccountId: account.id,
      accountNumberMasked: maskedAccount(account.accountNumber),
      holderLabel: holderLabel(account.holderGivenName, account.holderFamilyName),
    };
  }

  async createProposal(sessionToken: string, input: {
    sourceAccountId: string;
    beneficiaryId?: string;
    destinationAccountNumber?: string;
    amount: string;
    currency: "MXN";
    concept: string;
  }) {
    const principal = await this.principal(sessionToken, "transfers:create:own", false);
    const customer = await this.customer(principal.userId);
    const hasBeneficiary = input.beneficiaryId !== undefined;
    const hasNumber = input.destinationAccountNumber !== undefined;
    if (hasBeneficiary === hasNumber) {
      throw new AccountsError("VALIDATION_ERROR", "Indica un beneficiario o una cuenta, no ambos", [{ field: "destination", code: "xor" }]);
    }
    const source = await this.ownAccount(principal.userId, input.sourceAccountId);
    if (source.status !== "active") {
      throw new AccountsError("BUSINESS_RULE", "La cuenta no está disponible");
    }
    const destination = hasBeneficiary
      ? await this.destinationFromBeneficiary(customer.id, input.beneficiaryId ?? "")
      : await this.destinationFromNumber(input.destinationAccountNumber ?? "");
    const amount = Money.parse(input.amount);
    if (!amount.isPositive() || input.currency !== "MXN") {
      throw new AccountsError("BUSINESS_RULE", "El importe debe ser mayor que cero en MXN");
    }
    if (source.id === destination.id) {
      throw new AccountsError("BUSINESS_RULE", "El destino debe ser distinto del origen");
    }
    const limits = await this.effectiveLimits(principal.userId);
    const day = mexicoDay(this.clock.now());
    const consumed = Money.parse(await this.store.consumedOn(principal.userId, day.key));
    if (amount.greaterThan(Money.parse(limits.perTransferLimit)) || consumed.add(amount).greaterThan(Money.parse(limits.dailyLimit))) {
      throw new AccountsError("BUSINESS_RULE", "La operación supera el límite configurado");
    }
    if (amount.greaterThan(Money.parse(source.balance))) {
      throw new AccountsError("BUSINESS_RULE", "La cuenta no tiene saldo suficiente");
    }
    const now = this.clock.now();
    const proposal: ProposalRecord = {
      id: this.ids.uuid(),
      userId: principal.userId,
      sessionId: principal.sessionId,
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      destinationLabel: `${holderLabel(destination.holderGivenName, destination.holderFamilyName)} · ${maskedAccount(destination.accountNumber)}`,
      amount: amount.format(),
      currency: "MXN",
      concept: input.concept,
      status: "pending",
      expiresAt: new Date(now.getTime() + this.limits.proposalTtlSeconds * 1000).toISOString(),
      confirmedAt: null,
      rejectionReason: null,
      createdAt: now.toISOString(),
    };
    await this.store.saveProposal(proposal);
    return proposalOf(proposal, now);
  }

  async getProposal(sessionToken: string, proposalId: string) {
    const principal = await this.principal(sessionToken, "transfers:create:own", false);
    const proposal = await this.ownedProposal(principal, proposalId);
    return proposalOf(proposal, this.clock.now());
  }

  async cancelProposal(sessionToken: string, proposalId: string) {
    const principal = await this.principal(sessionToken, "transfers:create:own", false);
    const result = await this.store.cancelProposal(proposalId, principal.userId, principal.sessionId, this.clock.now().toISOString());
    if (result === "missing") {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
    if (result === "closed") {
      throw new AccountsError("BUSINESS_RULE", "La propuesta ya no está pendiente");
    }
  }

  async confirmProposal(sessionToken: string, proposalId: string, idempotencyKey: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "transfers:create:own", true);
    const customer = await this.customer(principal.userId);
    const proposal = await this.ownedProposal(principal, proposalId);
    const limits = await this.effectiveLimits(principal.userId);
    const now = this.clock.now();
    const result = await this.store.confirm({
      principal,
      ownerCustomerId: customer.id,
      proposalId,
      idempotencyKey,
      requestHash: confirmRequestHash(proposal),
      perTransferLimit: limits.perTransferLimit,
      dailyLimit: limits.dailyLimit,
      dayKey: mexicoDay(now).key,
      now: now.toISOString(),
      transferId: this.ids.uuid(),
      reference: `TRF${this.ids.uuid().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
      debitMovementId: this.ids.uuid(),
      creditMovementId: this.ids.uuid(),
      outboxId: this.ids.uuid(),
      idempotencyId: this.ids.uuid(),
      correlationId,
      reauthorize: () => this.authorizer.authorize(sessionToken, "transfers:create:own", true),
    });
    return transferOf(this.confirmed(result));
  }

  async getLimits(sessionToken: string) {
    const principal = await this.principal(sessionToken, "transfer-limits:read:own", false);
    const limits = await this.effectiveLimits(principal.userId);
    return {
      currency: "MXN" as const,
      perTransferLimit: limits.perTransferLimit,
      dailyLimit: limits.dailyLimit,
      perTransferMax: this.limits.perTransferMax,
      dailyMax: this.limits.dailyMax,
    };
  }

  async updateLimits(sessionToken: string, perTransferLimit: string, dailyLimit: string, correlationId: string) {
    const principal = await this.principal(sessionToken, "transfer-limits:update:own", true);
    assertPersonalLimits({
      perTransferLimit,
      dailyLimit,
      perTransferMax: this.limits.perTransferMax,
      dailyMax: this.limits.dailyMax,
    });
    const limits = { userId: principal.userId, currency: "MXN" as const, perTransferLimit, dailyLimit };
    await this.store.saveLimits(limits, this.event(principal.userId, correlationId, "transfer_limits.updated", principal.userId, {
      user_id: principal.userId,
      currency: "MXN",
      per_transfer_limit: perTransferLimit,
      daily_limit: dailyLimit,
    }));
    return {
      currency: "MXN" as const,
      perTransferLimit,
      dailyLimit,
      perTransferMax: this.limits.perTransferMax,
      dailyMax: this.limits.dailyMax,
    };
  }

  async eligibility(customerId: string, fields: Array<"totalBalance" | "accountAgeDays">) {
    const customer = await this.store.customerById(customerId);
    if (!customer || customer.status !== "active") {
      return { customerId, verifiable: false as const };
    }
    const accounts = await this.store.accountsOf(customer.id);
    const active = accounts.filter((item) => item.status === "active");
    const oldest = await this.store.oldestAccountAt(customer.id);
    if (active.length === 0 || !oldest) {
      return { customerId, verifiable: false as const };
    }
    const now = this.clock.now();
    const attributes: { totalBalance?: string; accountAgeDays?: number } = {};
    if (fields.includes("totalBalance")) {
      attributes.totalBalance = active.reduce((sum, item) => sum.add(Money.parse(item.balance)), Money.zero()).format();
    }
    if (fields.includes("accountAgeDays")) {
      const start = Date.parse(`${mexicoDay(new Date(oldest)).key}T00:00:00.000Z`);
      const end = Date.parse(`${mexicoDay(now).key}T00:00:00.000Z`);
      attributes.accountAgeDays = Math.max(0, Math.round((end - start) / 86_400_000));
    }
    return { customerId, verifiable: true as const, attributes };
  }

  async customerLink(userId: string) {
    const customer = await this.store.customerForUser(userId);
    if (!customer || customer.status !== "active") {
      return { userId, customerId: null };
    }
    return { userId, customerId: customer.id };
  }

  private confirmed(result: ConfirmResult): TransferRecord {
    if (result.kind === "completed") {
      return result.transfer;
    }
    if (result.kind === "hidden") {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
    if (result.kind === "conflict") {
      throw new AccountsError(result.code, result.code === "IDEMPOTENCY_CONFLICT" ? "La clave no corresponde a esta operación" : "La propuesta ya fue confirmada");
    }
    throw new AccountsError("BUSINESS_RULE", REASONS[result.reason] ?? "La transferencia no se pudo confirmar");
  }

  private async destinationFromBeneficiary(customerId: string, beneficiaryId: string) {
    const beneficiary = await this.store.findBeneficiary(customerId, beneficiaryId);
    if (!beneficiary) {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El destinatario no está disponible");
    }
    const account = await this.store.findAccount(beneficiary.destinationAccountId);
    if (!account || account.status !== "active") {
      throw new AccountsError("BUSINESS_RULE", "La cuenta no está disponible");
    }
    return this.withHolder(account);
  }

  private async destinationFromNumber(accountNumber: string) {
    const account = await this.store.findByAccountNumber(accountNumber);
    if (!account || account.status !== "active") {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El destinatario no está disponible");
    }
    return account;
  }

  private async withHolder(account: AccountRecord) {
    const resolved = await this.store.findByAccountNumber(account.accountNumber);
    return resolved ?? { ...account, holderGivenName: "", holderFamilyName: "" };
  }

  private async effectiveLimits(userId: string) {
    const stored = await this.store.limitsFor(userId);
    return {
      perTransferLimit: stored?.perTransferLimit ?? this.limits.perTransferDefault,
      dailyLimit: stored?.dailyLimit ?? this.limits.dailyDefault,
    };
  }

  private async ownAccount(userId: string, accountId: string) {
    const customer = await this.customer(userId);
    const account = await this.store.findAccount(accountId);
    if (!account || account.customerId !== customer.id) {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
    return account;
  }

  private async ownedProposal(principal: Principal, proposalId: string) {
    const proposal = await this.store.findProposal(proposalId);
    if (!proposal || proposal.userId !== principal.userId || proposal.sessionId !== principal.sessionId) {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
    return proposal;
  }

  private async visibleTransfer(userId: string, transferId: string) {
    const customer = await this.customer(userId);
    const transfer = await this.store.findTransfer(transferId);
    const source = transfer ? await this.store.findAccount(transfer.sourceAccountId) : null;
    const destination = transfer ? await this.store.findAccount(transfer.destinationAccountId) : null;
    if (!transfer || (source?.customerId !== customer.id && destination?.customerId !== customer.id)) {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
    return transfer;
  }

  private async customer(userId: string) {
    const customer = await this.store.customerForUser(userId);
    if (!customer || customer.status !== "active") {
      throw new AccountsError("RESOURCE_NOT_VISIBLE", "El recurso no está disponible");
    }
    return customer;
  }

  private async principal(sessionToken: string, permission: string, recent: boolean): Promise<Principal> {
    return this.authorizer.authorize(sessionToken, permission, recent);
  }

  private event(actorId: string, correlationId: string, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    return {
      id: this.ids.uuid(),
      eventType,
      aggregateId,
      actorId,
      correlationId,
      payload,
      occurredAt: this.clock.now().toISOString(),
      publishedAt: null,
      attemptCount: 0,
    };
  }
}

function accountOf(account: AccountRecord) {
  return {
    id: account.id,
    accountNumber: account.accountNumber,
    name: account.name,
    currency: "MXN" as const,
    status: account.status,
    balance: account.balance,
  };
}

function movementOf(movement: MovementRecord) {
  return {
    id: movement.id,
    direction: movement.direction,
    amount: movement.amount,
    currency: "MXN" as const,
    balanceAfter: movement.balanceAfter,
    recordedAt: movement.recordedAt,
    ...(movement.transferId ? { transferId: movement.transferId } : {}),
  };
}

function transferOf(transfer: TransferRecord) {
  return {
    id: transfer.id,
    reference: transfer.reference,
    proposalId: transfer.proposalId,
    status: transfer.status,
    amount: transfer.amount,
    currency: "MXN" as const,
    concept: transfer.concept,
    completedAt: transfer.completedAt,
  };
}

function beneficiaryOf(beneficiary: { id: string; alias: string; destinationAccountId: string; status: "active" | "deleted" }) {
  return {
    id: beneficiary.id,
    alias: beneficiary.alias,
    destinationAccountId: beneficiary.destinationAccountId,
    status: beneficiary.status,
  };
}

function proposalOf(proposal: ProposalRecord, now: Date) {
  return {
    id: proposal.id,
    status: proposalVisibleStatus(proposal.status, proposal.expiresAt, now),
    sourceAccountId: proposal.sourceAccountId,
    destinationAccountId: proposal.destinationAccountId,
    destinationLabel: proposal.destinationLabel,
    amount: proposal.amount,
    currency: "MXN" as const,
    concept: proposal.concept,
    expiresAt: proposal.expiresAt,
  };
}
