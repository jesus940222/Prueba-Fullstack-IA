import type { QueryRunner } from "typeorm";
import { DataSource } from "typeorm";
import { AccountsError } from "../../domain/accounts-error";
import { escapeLike, type BeneficiaryCursor } from "../../domain/cursor";
import { Money } from "../../domain/money";
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
import { decideTransfer } from "../../domain/transfer-policy";
import type { AccountsStore, ConfirmCommand, ConfirmResult, MovementFilter, ResolvedAccount } from "../../application/ports";

type Row = Record<string, unknown>;

export class PostgresAccountsStore implements AccountsStore {
  constructor(private readonly dataSource: DataSource) {}

  async customerForUser(userId: string): Promise<CustomerRecord | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT c.id, c.customer_number, c.given_name, c.family_name, c.status
       FROM user_customers link JOIN customers c ON c.id = link.customer_id
       WHERE link.user_id = $1 AND link.status = 'active'`,
      [userId],
    );
    const row = rows[0];
    return row ? customerOf(row) : null;
  }

  async customerById(customerId: string): Promise<CustomerRecord | null> {
    const rows = await this.dataSource.query<Row[]>(`SELECT id, customer_number, given_name, family_name, status FROM customers WHERE id = $1`, [customerId]);
    const row = rows[0];
    return row ? customerOf(row) : null;
  }

  async accountsOf(customerId: string): Promise<AccountRecord[]> {
    const rows = await this.dataSource.query<Row[]>(`${ACCOUNT_SELECT} WHERE customer_id = $1 ORDER BY created_at, id`, [customerId]);
    return rows.map(accountOf);
  }

  async listAccounts(customerId: string, query: PageQuery) {
    const total = await this.count(`SELECT count(*)::int AS total FROM accounts WHERE customer_id = $1`, [customerId]);
    const rows = await this.dataSource.query<Row[]>(
      `${ACCOUNT_SELECT} WHERE customer_id = $1 ORDER BY created_at ${direction(query.sort)}, id ${direction(query.sort)} OFFSET $2 LIMIT $3`,
      [customerId, (query.page - 1) * query.pageSize, query.pageSize],
    );
    return { items: rows.map(accountOf), totalItems: total };
  }

  async findAccount(accountId: string) {
    const rows = await this.dataSource.query<Row[]>(`${ACCOUNT_SELECT} WHERE id = $1`, [accountId]);
    const row = rows[0];
    return row ? accountOf(row) : null;
  }

  async listMovements(accountId: string, query: PageQuery, filter: MovementFilter) {
    const where = ["account_id = $1"];
    const params: unknown[] = [accountId];
    if (filter.direction) {
      params.push(filter.direction);
      where.push(`direction = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      where.push(`recorded_at >= $${params.length}::timestamptz`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`recorded_at < $${params.length}::timestamptz`);
    }
    const clause = where.join(" AND ");
    const total = await this.count(`SELECT count(*)::int AS total FROM movements WHERE ${clause}`, params);
    params.push((query.page - 1) * query.pageSize, query.pageSize);
    const rows = await this.dataSource.query<Row[]>(
      `${MOVEMENT_SELECT} WHERE ${clause} ORDER BY recorded_at ${direction(query.sort)}, id ${direction(query.sort)} OFFSET $${params.length - 1} LIMIT $${params.length}`,
      params,
    );
    return { items: rows.map(movementOf), totalItems: total };
  }

  async movementsForCustomer(customerId: string) {
    const rows = await this.dataSource.query<Row[]>(
      `${MOVEMENT_SELECT} WHERE account_id IN (SELECT id FROM accounts WHERE customer_id = $1)`,
      [customerId],
    );
    return rows.map(movementOf);
  }

  async listBeneficiaries(customerId: string, search: string, cursor: BeneficiaryCursor | null, limit: number) {
    if (cursor) {
      const exists = await this.dataSource.query<Row[]>(
        `SELECT id FROM beneficiaries WHERE customer_id = $1 AND deleted_at IS NULL AND alias = $2 AND id = $3 AND ($4 = '' OR alias ILIKE '%' || $4 || '%' ESCAPE '\\')`,
        [customerId, cursor.alias, cursor.id, escapeLike(search)],
      );
      if (exists.length === 0) {
        throw new AccountsError("VALIDATION_ERROR", "El cursor no corresponde a esta búsqueda", [{ field: "cursor", code: "invalid" }]);
      }
    }
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, customer_id, destination_account_id, alias, status, created_at
       FROM beneficiaries
       WHERE customer_id = $1 AND deleted_at IS NULL
         AND ($2 = '' OR alias ILIKE '%' || $2 || '%' ESCAPE '\\')
         AND ($3::boolean = false OR (alias, id) > ($4, $5::uuid))
       ORDER BY alias, id
       LIMIT $6`,
      [customerId, escapeLike(search), cursor !== null, cursor?.alias ?? "", cursor?.id ?? "00000000-0000-4000-8000-000000000000", limit + 1],
    );
    const page = rows.slice(0, limit).map(beneficiaryOf);
    const last = page[page.length - 1];
    const hasMore = rows.length > limit;
    return {
      items: page,
      hasMore,
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ search, alias: last.alias, id: last.id }), "utf8").toString("base64url") : null,
    };
  }

  async findBeneficiary(customerId: string, beneficiaryId: string) {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, customer_id, destination_account_id, alias, status, created_at FROM beneficiaries WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
      [beneficiaryId, customerId],
    );
    const row = rows[0];
    return row ? beneficiaryOf(row) : null;
  }

  async findActiveBeneficiary(customerId: string, destinationAccountId: string) {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, customer_id, destination_account_id, alias, status, created_at
       FROM beneficiaries WHERE customer_id = $1 AND destination_account_id = $2 AND deleted_at IS NULL`,
      [customerId, destinationAccountId],
    );
    const row = rows[0];
    return row ? beneficiaryOf(row) : null;
  }

  async saveBeneficiary(beneficiary: BeneficiaryRecord, event: OutboxRecord) {
    await this.transaction(async (runner) => {
      await runner.query(
        `INSERT INTO beneficiaries (id, customer_id, destination_account_id, alias, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $5)`,
        [beneficiary.id, beneficiary.customerId, beneficiary.destinationAccountId, beneficiary.alias, beneficiary.createdAt],
      );
      await insertOutbox(runner, event);
    });
  }

  async renameBeneficiary(customerId: string, beneficiaryId: string, alias: string, event: OutboxRecord) {
    return this.transaction(async (runner) => {
      const rows = returnedRows(await runner.query(
        `UPDATE beneficiaries SET alias = $3, updated_at = $4 WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL
         RETURNING id, customer_id, destination_account_id, alias, status, created_at`,
        [beneficiaryId, customerId, alias, event.occurredAt],
      ));
      const row = rows[0];
      if (!row) {
        return null;
      }
      await insertOutbox(runner, event);
      return beneficiaryOf(row);
    });
  }

  async deleteBeneficiary(customerId: string, beneficiaryId: string, at: string, event: OutboxRecord) {
    return this.transaction(async (runner) => {
      const rows = returnedRows(await runner.query(
        `UPDATE beneficiaries SET status = 'deleted', deleted_at = $3, deleted_by = $4, updated_at = $3
         WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL RETURNING id`,
        [beneficiaryId, customerId, at, event.actorId],
      ));
      if (rows.length === 0) {
        return false;
      }
      await insertOutbox(runner, event);
      return true;
    });
  }

  async findByAccountNumber(accountNumber: string): Promise<ResolvedAccount | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT a.id, a.customer_id, a.account_number, a.name, a.currency, a.status, a.balance::text AS balance, a.closed_at, a.created_at,
              c.given_name, c.family_name
       FROM accounts a JOIN customers c ON c.id = a.customer_id WHERE a.account_number = $1`,
      [accountNumber],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { ...accountOf(row), holderGivenName: text(row, "given_name"), holderFamilyName: text(row, "family_name") };
  }

  async countResolves(userId: string, since: string) {
    return this.count(`SELECT count(*)::int AS total FROM recipient_resolve_attempts WHERE user_id = $1 AND attempted_at >= $2::timestamptz`, [userId, since]);
  }

  async recordResolve(id: string, userId: string, at: string) {
    await this.dataSource.query(`INSERT INTO recipient_resolve_attempts (id, user_id, attempted_at) VALUES ($1, $2, $3)`, [id, userId, at]);
  }

  async saveProposal(proposal: ProposalRecord) {
    await this.dataSource.query(
      `INSERT INTO transfer_proposals (
         id, user_id, session_id, source_account_id, destination_account_id, destination_label,
         amount, currency, concept, status, expires_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'MXN',$8,'pending',$9,$10,$10)`,
      [proposal.id, proposal.userId, proposal.sessionId, proposal.sourceAccountId, proposal.destinationAccountId, proposal.destinationLabel, proposal.amount, proposal.concept, proposal.expiresAt, proposal.createdAt],
    );
  }

  async findProposal(proposalId: string) {
    const rows = await this.dataSource.query<Row[]>(`${PROPOSAL_SELECT} WHERE id = $1`, [proposalId]);
    const row = rows[0];
    return row ? proposalOf(row) : null;
  }

  async cancelProposal(proposalId: string, userId: string, sessionId: string, now: string) {
    const rows = await this.dataSource.query(
      `UPDATE transfer_proposals SET status = 'cancelled', updated_at = $4
       WHERE id = $1 AND user_id = $2 AND session_id = $3 AND status = 'pending' AND expires_at > $4::timestamptz
       RETURNING id`,
      [proposalId, userId, sessionId, now],
    ) as Row[];
    if (rows.length === 1) {
      return "cancelled" as const;
    }
    const found = await this.dataSource.query<Row[]>(`SELECT id FROM transfer_proposals WHERE id = $1 AND user_id = $2 AND session_id = $3`, [proposalId, userId, sessionId]);
    return found.length === 0 ? "missing" as const : "closed" as const;
  }

  async limitsFor(userId: string) {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT user_id, per_transfer_limit::text AS per_transfer_limit, daily_limit::text AS daily_limit FROM user_transfer_limits WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { userId, currency: "MXN" as const, perTransferLimit: money(row.per_transfer_limit), dailyLimit: money(row.daily_limit) };
  }

  async saveLimits(limits: LimitsRecord, event: OutboxRecord) {
    await this.transaction(async (runner) => {
      await runner.query(
        `INSERT INTO user_transfer_limits (id, user_id, currency, per_transfer_limit, daily_limit, updated_by, updated_at)
         VALUES ($1, $2, 'MXN', $3, $4, $2, $5)
         ON CONFLICT (user_id) DO UPDATE SET per_transfer_limit = EXCLUDED.per_transfer_limit, daily_limit = EXCLUDED.daily_limit, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [event.id, limits.userId, limits.perTransferLimit, limits.dailyLimit, event.occurredAt],
      );
      await insertOutbox(runner, event);
    });
  }

  async consumedOn(userId: string, dayKey: string) {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT consumed_amount::text AS consumed FROM daily_transfer_usage WHERE user_id = $1 AND currency = 'MXN' AND day_key = $2::date`,
      [userId, dayKey],
    );
    return money(rows[0]?.consumed ?? "0.00");
  }

  async confirm(command: ConfirmCommand): Promise<ConfirmResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await lockKey(runner, `idempotency:${command.principal.userId}:transfer.confirm:${command.idempotencyKey}`);
      await lockKey(runner, `proposal:${command.proposalId}`);
      const proposals = await runner.query(`${PROPOSAL_SELECT} WHERE id = $1 FOR UPDATE`, [command.proposalId]) as Row[];
      const proposal = proposals[0] ? proposalOf(proposals[0]) : null;
      if (!proposal) {
        await runner.commitTransaction();
        return { kind: "hidden" };
      }
      const accountIds = [proposal.sourceAccountId, proposal.destinationAccountId].sort();
      const lockedAccounts = await runner.query(`${ACCOUNT_SELECT} WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [accountIds]) as Row[];
      await runner.query(
        `INSERT INTO daily_transfer_usage (user_id, currency, day_key, consumed_amount) VALUES ($1, 'MXN', $2::date, 0) ON CONFLICT DO NOTHING`,
        [command.principal.userId, command.dayKey],
      );
      const usageRows = await runner.query(
        `SELECT consumed_amount::text AS consumed FROM daily_transfer_usage WHERE user_id = $1 AND currency = 'MXN' AND day_key = $2::date FOR UPDATE`,
        [command.principal.userId, command.dayKey],
      ) as Row[];
      const idempotencyRows = await runner.query(
        `SELECT request_hash, transfer_id, status, reason_code FROM idempotency_records
         WHERE user_id = $1 AND operation = 'transfer.confirm' AND idempotency_key = $2 FOR UPDATE`,
        [command.principal.userId, command.idempotencyKey],
      ) as Row[];
      const existingRows = await runner.query(`SELECT id FROM transfers WHERE proposal_id = $1`, [proposal.id]) as Row[];
      await command.reauthorize();
      const accounts = lockedAccounts.map(accountOf);
      const decision = decideTransfer({
        proposal,
        source: accounts.find((item) => item.id === proposal.sourceAccountId) ?? null,
        destination: accounts.find((item) => item.id === proposal.destinationAccountId) ?? null,
        ownerCustomerId: command.ownerCustomerId,
        actorUserId: command.principal.userId,
        actorSessionId: command.principal.sessionId,
        perTransferLimit: command.perTransferLimit,
        dailyLimit: command.dailyLimit,
        consumedToday: money(usageRows[0]?.consumed ?? "0.00"),
        now: new Date(command.now),
        requestHash: command.requestHash,
        idempotency: idempotencyRows[0] ? {
          requestHash: text(idempotencyRows[0], "request_hash"),
          transferId: idempotencyRows[0].transfer_id === null ? null : text(idempotencyRows[0], "transfer_id"),
          status: text(idempotencyRows[0], "status") === "completed" ? "completed" : "rejected",
          reasonCode: idempotencyRows[0].reason_code === null ? null : text(idempotencyRows[0], "reason_code"),
        } : null,
        existingTransferId: existingRows[0] ? text(existingRows[0], "id") : null,
      });
      const result = await this.applyDecision(runner, command, proposal, decision);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async listTransfers(customerId: string, query: PageQuery) {
    const filter = `source_account_id IN (SELECT id FROM accounts WHERE customer_id = $1) OR destination_account_id IN (SELECT id FROM accounts WHERE customer_id = $1)`;
    const total = await this.count(`SELECT count(*)::int AS total FROM transfers WHERE ${filter}`, [customerId]);
    const rows = await this.dataSource.query<Row[]>(
      `${TRANSFER_SELECT} WHERE ${filter} ORDER BY completed_at ${direction(query.sort)}, id ${direction(query.sort)} OFFSET $2 LIMIT $3`,
      [customerId, (query.page - 1) * query.pageSize, query.pageSize],
    );
    return { items: rows.map(transferOf), totalItems: total };
  }

  async findTransfer(transferId: string) {
    const rows = await this.dataSource.query<Row[]>(`${TRANSFER_SELECT} WHERE id = $1`, [transferId]);
    const row = rows[0];
    return row ? transferOf(row) : null;
  }

  async oldestAccountAt(customerId: string) {
    const rows = await this.dataSource.query<Row[]>(`SELECT min(created_at) AS created_at FROM accounts WHERE customer_id = $1`, [customerId]);
    return rows[0]?.created_at ? iso(rows[0].created_at) : null;
  }

  async unpublishedOutbox(limit: number) {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, event_type, aggregate_id, actor_id, correlation_id, payload, occurred_at, published_at, attempt_count
       FROM outbox_events WHERE published_at IS NULL ORDER BY occurred_at, id LIMIT $1`,
      [limit],
    );
    return rows.map(outboxOf);
  }

  async markOutboxPublished(ids: readonly string[], at: string) {
    if (ids.length === 0) {
      return;
    }
    await this.dataSource.query(`UPDATE outbox_events SET published_at = $2, attempt_count = attempt_count + 1 WHERE id = ANY($1::uuid[]) AND published_at IS NULL`, [ids, at]);
  }

  async idempotencyFor(userId: string, key: string) {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, user_id, operation, idempotency_key, request_hash, transfer_id, status, reason_code
       FROM idempotency_records WHERE user_id = $1 AND operation = 'transfer.confirm' AND idempotency_key = $2`,
      [userId, key],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    const record: IdempotencyRecord = {
      id: text(row, "id"),
      userId,
      operation: "transfer.confirm",
      idempotencyKey: key,
      requestHash: text(row, "request_hash"),
      transferId: row.transfer_id === null ? null : text(row, "transfer_id"),
      status: text(row, "status") === "completed" ? "completed" : "rejected",
      reasonCode: row.reason_code === null ? null : text(row, "reason_code"),
    };
    return record;
  }

  private async applyDecision(runner: QueryRunner, command: ConfirmCommand, proposal: ProposalRecord, decision: ReturnType<typeof decideTransfer>): Promise<ConfirmResult> {
    if (decision.kind === "hidden" || decision.kind === "conflict") {
      return decision;
    }
    if (decision.kind === "replay") {
      const rows = await runner.query(`${TRANSFER_SELECT} WHERE id = $1`, [decision.transferId]) as Row[];
      const row = rows[0];
      return row ? { kind: "completed", transfer: transferOf(row) } : { kind: "hidden" };
    }
    if (decision.kind === "reject") {
      if (!decision.alreadyRecorded) {
        await runner.query(
          `UPDATE transfer_proposals SET status = $2, rejection_reason = $3, updated_at = $4 WHERE id = $1`,
          [proposal.id, decision.status, decision.reason, command.now],
        );
        await runner.query(
          `INSERT INTO idempotency_records (id, user_id, operation, idempotency_key, request_hash, transfer_id, status, reason_code, expires_at)
           VALUES ($1, $2, 'transfer.confirm', $3, $4, NULL, 'rejected', $5, $6)`,
          [command.idempotencyId, command.principal.userId, command.idempotencyKey, command.requestHash, decision.reason, command.now],
        );
        await insertOutbox(runner, rejectedOutbox(command, proposal.id, decision.reason));
      }
      return { kind: "rejected", reason: decision.reason };
    }
    const usage = returnedRows(await runner.query(
      `UPDATE daily_transfer_usage SET consumed_amount = consumed_amount + $3::numeric
       WHERE user_id = $1 AND currency = 'MXN' AND day_key = $2::date AND consumed_amount + $3::numeric <= $4::numeric
       RETURNING consumed_amount::text AS consumed`,
      [command.principal.userId, command.dayKey, proposal.amount, command.dailyLimit],
    ));
    const debited = returnedRows(await runner.query(
      `UPDATE accounts SET balance = balance - $2::numeric, updated_at = $3 WHERE id = $1 AND status = 'active' AND balance >= $2::numeric RETURNING balance::text AS balance`,
      [proposal.sourceAccountId, proposal.amount, command.now],
    ));
    const credited = returnedRows(await runner.query(
      `UPDATE accounts SET balance = balance + $2::numeric, updated_at = $3 WHERE id = $1 AND status = 'active' RETURNING balance::text AS balance`,
      [proposal.destinationAccountId, proposal.amount, command.now],
    ));
    if (usage.length !== 1 || debited.length !== 1 || credited.length !== 1) {
      throw new AccountsError("BUSINESS_RULE", "La transferencia no se pudo confirmar");
    }
    if (money(debited[0]?.balance) !== decision.sourceBalance || money(credited[0]?.balance) !== decision.destinationBalance) {
      throw new AccountsError("BUSINESS_RULE", "La transferencia no se pudo confirmar");
    }
    await runner.query(
      `INSERT INTO transfers (
         id, reference, proposal_id, initiated_by, source_account_id, destination_account_id, destination_label,
         amount, currency, concept, status, completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MXN',$9,'completed',$10)`,
      [command.transferId, command.reference, proposal.id, command.principal.userId, proposal.sourceAccountId, proposal.destinationAccountId, proposal.destinationLabel, proposal.amount, proposal.concept, command.now],
    );
    await runner.query(
      `INSERT INTO movements (id, account_id, transfer_id, type, direction, amount, currency, balance_after, recorded_at)
       VALUES ($1,$2,$3,'transfer','out',$4,'MXN',$5,$6), ($7,$8,$3,'transfer','in',$4,'MXN',$9,$6)`,
      [command.debitMovementId, proposal.sourceAccountId, command.transferId, proposal.amount, decision.sourceBalance, command.now, command.creditMovementId, proposal.destinationAccountId, decision.destinationBalance],
    );
    await runner.query(`UPDATE transfer_proposals SET status = 'confirmed', confirmed_at = $2, updated_at = $2 WHERE id = $1`, [proposal.id, command.now]);
    await runner.query(
      `INSERT INTO idempotency_records (id, user_id, operation, idempotency_key, request_hash, transfer_id, status, expires_at)
       VALUES ($1,$2,'transfer.confirm',$3,$4,$5,'completed',$6)`,
      [command.idempotencyId, command.principal.userId, command.idempotencyKey, command.requestHash, command.transferId, command.now],
    );
    await insertOutbox(runner, {
      id: command.outboxId,
      eventType: "transfer.completed",
      aggregateId: command.transferId,
      actorId: command.principal.userId,
      correlationId: command.correlationId,
      occurredAt: command.now,
      publishedAt: null,
      attemptCount: 0,
      payload: {
        transfer_id: command.transferId,
        reference: command.reference,
        source_account_id: proposal.sourceAccountId,
        destination_account_id: proposal.destinationAccountId,
        amount: proposal.amount,
        currency: "MXN",
      },
    });
    const rows = await runner.query(`${TRANSFER_SELECT} WHERE id = $1`, [command.transferId]) as Row[];
    const row = rows[0];
    if (!row) {
      throw new AccountsError("BUSINESS_RULE", "La transferencia no se pudo confirmar");
    }
    return { kind: "completed", transfer: transferOf(row) };
  }

  private async count(sql: string, params: unknown[]) {
    const rows = await this.dataSource.query<Row[]>(sql, params);
    return Number(rows[0]?.total ?? 0);
  }

  private async transaction<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const result = await work(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}

const ACCOUNT_SELECT = `SELECT id, customer_id, account_number, name, currency, status, balance::text AS balance, closed_at, created_at FROM accounts`;
const MOVEMENT_SELECT = `SELECT id, account_id, transfer_id, type, direction, amount::text AS amount, balance_after::text AS balance_after, recorded_at FROM movements`;
const PROPOSAL_SELECT = `SELECT id, user_id, session_id, source_account_id, destination_account_id, destination_label, amount::text AS amount, currency, concept, status, expires_at, confirmed_at, rejection_reason, created_at FROM transfer_proposals`;
const TRANSFER_SELECT = `SELECT id, reference, proposal_id, initiated_by, source_account_id, destination_account_id, destination_label, amount::text AS amount, concept, status, completed_at FROM transfers`;

function direction(sort: PageQuery["sort"]): "ASC" | "DESC" {
  return sort === "createdAt" ? "ASC" : "DESC";
}

function customerOf(row: Row): CustomerRecord {
  const status = text(row, "status");
  return {
    id: text(row, "id"),
    customerNumber: text(row, "customer_number"),
    givenName: text(row, "given_name"),
    familyName: text(row, "family_name"),
    status: status === "disabled" ? "disabled" : "active",
  };
}

function accountOf(row: Row): AccountRecord {
  const status = text(row, "status");
  return {
    id: text(row, "id"),
    customerId: text(row, "customer_id"),
    accountNumber: text(row, "account_number"),
    name: text(row, "name"),
    currency: "MXN",
    status: status === "closed" ? "closed" : "active",
    balance: money(row.balance),
    closedAt: row.closed_at ? iso(row.closed_at) : null,
    createdAt: iso(row.created_at),
  };
}

function movementOf(row: Row): MovementRecord {
  const directionValue = text(row, "direction");
  const type = text(row, "type");
  return {
    id: text(row, "id"),
    accountId: text(row, "account_id"),
    transferId: row.transfer_id === null ? null : text(row, "transfer_id"),
    type: type === "opening" || type === "purchase" ? type : "transfer",
    direction: directionValue === "in" ? "in" : "out",
    amount: money(row.amount),
    currency: "MXN",
    balanceAfter: money(row.balance_after),
    recordedAt: iso(row.recorded_at),
  };
}

function beneficiaryOf(row: Row): BeneficiaryRecord {
  return {
    id: text(row, "id"),
    customerId: text(row, "customer_id"),
    destinationAccountId: text(row, "destination_account_id"),
    alias: text(row, "alias"),
    status: text(row, "status") === "deleted" ? "deleted" : "active",
    createdAt: iso(row.created_at),
  };
}

function proposalOf(row: Row): ProposalRecord {
  const status = text(row, "status");
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    sessionId: text(row, "session_id"),
    sourceAccountId: text(row, "source_account_id"),
    destinationAccountId: text(row, "destination_account_id"),
    destinationLabel: text(row, "destination_label"),
    amount: money(row.amount),
    currency: "MXN",
    concept: text(row, "concept"),
    status: status === "confirmed" || status === "cancelled" || status === "rejected" || status === "expired" ? status : "pending",
    expiresAt: iso(row.expires_at),
    confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : null,
    rejectionReason: row.rejection_reason === null || row.rejection_reason === undefined ? null : text(row, "rejection_reason"),
    createdAt: iso(row.created_at),
  };
}

function transferOf(row: Row): TransferRecord {
  return {
    id: text(row, "id"),
    reference: text(row, "reference"),
    proposalId: text(row, "proposal_id"),
    initiatedBy: text(row, "initiated_by"),
    sourceAccountId: text(row, "source_account_id"),
    destinationAccountId: text(row, "destination_account_id"),
    destinationLabel: text(row, "destination_label"),
    amount: money(row.amount),
    currency: "MXN",
    concept: text(row, "concept"),
    status: "completed",
    completedAt: iso(row.completed_at),
  };
}

function outboxOf(row: Row): OutboxRecord {
  return {
    id: text(row, "id"),
    eventType: text(row, "event_type"),
    aggregateId: text(row, "aggregate_id"),
    actorId: text(row, "actor_id"),
    correlationId: text(row, "correlation_id"),
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) as Record<string, unknown> : row.payload as Record<string, unknown>,
    occurredAt: iso(row.occurred_at),
    publishedAt: row.published_at ? iso(row.published_at) : null,
    attemptCount: Number(row.attempt_count ?? 0),
  };
}

function rejectedOutbox(command: ConfirmCommand, proposalId: string, reason: string): OutboxRecord {
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

async function insertOutbox(runner: QueryRunner, event: OutboxRecord): Promise<void> {
  await runner.query(
    `INSERT INTO outbox_events (id, event_type, aggregate_id, actor_id, correlation_id, payload, occurred_at, attempt_count)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0)`,
    [event.id, event.eventType, event.aggregateId, event.actorId, event.correlationId, JSON.stringify(event.payload), event.occurredAt],
  );
}

async function lockKey(runner: QueryRunner, key: string): Promise<void> {
  await runner.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AccountsError("DEPENDENCY_UNAVAILABLE", "No se pudo leer la cuenta");
  }
  return String(value);
}

function returnedRows(result: unknown): Row[] {
  if (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === "number") {
    return result[0] as Row[];
  }
  return Array.isArray(result) ? result as Row[] : [];
}

function money(value: unknown): string {
  return Money.parse(typeof value === "number" ? value.toFixed(2) : String(value ?? "0.00")).format();
}

function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return new Date(value).toISOString();
  }
  throw new AccountsError("DEPENDENCY_UNAVAILABLE", "No se pudo leer la cuenta");
}
