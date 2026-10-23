import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { AccountsError } from "../../domain/accounts-error";
import { movementBalance } from "../../domain/spend";
import { AccountsWorkflows } from "../../application/accounts-workflows";
import { publishPending } from "../../application/outbox";
import type { Authorizer } from "../../application/ports";
import { Baseline1730000000000 } from "./baseline.migration";
import { PostgresAccountsStore } from "./postgres-accounts-store";
import { AccountsSchema1732100000000 } from "./schema.migration";

const gateUrl = process.env.ACCOUNTS_GATE_DATABASE_URL ?? "";
const gate = gateUrl === "" ? describe.skip : describe;

function sourceFor(url: string): DataSource {
  return new DataSource({
    type: "postgres",
    url,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    migrations: [Baseline1730000000000, AccountsSchema1732100000000],
    extra: { max: 8 },
  });
}

gate("transfer concurrency", () => {
  const source = sourceFor(gateUrl);
  const userId = "00000000-0000-4000-8000-000000000101";
  const sessionId = "00000000-0000-4000-8000-000000000102";
  const customerId = "00000000-0000-4000-8000-000000000103";
  const otherCustomer = "00000000-0000-4000-8000-000000000104";
  const sourceId = "00000000-0000-4000-8000-000000000105";
  const destinationId = "00000000-0000-4000-8000-000000000106";

  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    await source.query("TRUNCATE customers CASCADE");
    const now = new Date().toISOString();
    await source.query(`INSERT INTO customers (id, customer_number, given_name, family_name, status, created_at, updated_at) VALUES ($1, 'G-1', 'Ana', 'Gate', 'active', $2, $2), ($3, 'G-2', 'Bruno', 'Gate', 'active', $2, $2)`, [customerId, now, otherCustomer]);
    await source.query(`INSERT INTO user_customers (id, user_id, customer_id, status, created_at) VALUES ($1, $2, $3, 'active', $4)`, [randomUUID(), userId, customerId, now]);
    await source.query(
      `INSERT INTO accounts (id, customer_id, account_number, name, currency, status, balance, created_at, updated_at)
       VALUES ($1, $2, '2000000000000001', 'Origen', 'MXN', 'active', 100.00, $3, $3), ($4, $5, '2000000000000002', 'Destino', 'MXN', 'active', 0.00, $3, $3)`,
      [sourceId, customerId, now, destinationId, otherCustomer],
    );
    await source.query(
      `INSERT INTO movements (id, account_id, type, direction, amount, currency, balance_after, recorded_at)
       VALUES ($1, $2, 'opening', 'in', 100.00, 'MXN', 100.00, $3), ($4, $5, 'opening', 'in', 0.01, 'MXN', 0.01, $3)`,
      [randomUUID(), sourceId, now, randomUUID(), destinationId],
    );
    await source.query(`UPDATE accounts SET balance = 0.01 WHERE id = $1`, [destinationId]);
  });

  afterAll(async () => {
    if (source.isInitialized) {
      await source.destroy();
    }
  });

  function workflows(authorizer?: Authorizer) {
    return new AccountsWorkflows(
      new PostgresAccountsStore(source),
      authorizer ?? { async authorize() { return { userId, sessionId }; } },
      { now: () => new Date() },
      { uuid: () => randomUUID() },
      {
        perTransferDefault: "100.00",
        dailyDefault: "100.00",
        perTransferMax: "50000.00",
        dailyMax: "100000.00",
        proposalTtlSeconds: 300,
        resolveLimit: 20,
        resolveWindowSeconds: 60,
      },
    );
  }

  async function propose(app: AccountsWorkflows, amount: string) {
    return app.createProposal("token", {
      sourceAccountId: sourceId,
      destinationAccountNumber: "2000000000000002",
      amount,
      currency: "MXN",
      concept: "Concurrencia",
    });
  }

  it("does not overdraw or double-post when two confirms race", async () => {
    await source.query(`UPDATE accounts SET balance = 100.00 WHERE id = $1`, [sourceId]);
    await source.query(`DELETE FROM daily_transfer_usage WHERE user_id = $1`, [userId]);
    const app = workflows();
    const left = await propose(app, "60.00");
    const right = await propose(app, "60.00");
    const settled = await Promise.allSettled([
      app.confirmProposal("token", left.id, "race-balance-key-01", randomUUID()),
      app.confirmProposal("token", right.id, "race-balance-key-02", randomUUID()),
    ]);
    const completed = settled.filter((item) => item.status === "fulfilled");
    expect(completed).toHaveLength(1);
    const balances = await source.query(`SELECT id, balance::text AS balance FROM accounts WHERE id = ANY($1::uuid[])`, [[sourceId, destinationId]]) as Array<{ id: string; balance: string }>;
    expect(Number(balances.find((item) => item.id === sourceId)?.balance).toFixed(2)).toBe("40.00");
    const movements = await source.query(`SELECT direction, amount::text AS amount FROM movements WHERE account_id = $1`, [sourceId]) as Array<{ direction: string; amount: string }>;
    const signed = movementBalance(movements.map((item, index) => ({
      id: String(index),
      accountId: sourceId,
      transferId: null,
      type: "opening" as const,
      direction: item.direction === "in" ? "in" as const : "out" as const,
      amount: item.amount,
      currency: "MXN" as const,
      balanceAfter: "0.00",
      recordedAt: new Date().toISOString(),
    })));
    expect(signed).toBe("40.00");
    const totals = await source.query(`SELECT count(*)::int AS total FROM transfers`) as Array<{ total: number }>;
    expect(Number(totals[0]?.total)).toBe(1);
  });

  it("serializes the daily limit, replays one key and keeps the outbox after a failed publish", async () => {
    await source.query(`UPDATE accounts SET balance = 100.00 WHERE id = $1`, [sourceId]);
    await source.query(`DELETE FROM daily_transfer_usage WHERE user_id = $1`, [userId]);
    await source.query(`DELETE FROM idempotency_records`);
    await source.query(`DELETE FROM movements WHERE type = 'transfer'`);
    await source.query(`DELETE FROM outbox_events`);
    await source.query(`DELETE FROM transfers`);
    await source.query(`UPDATE transfer_proposals SET status = 'cancelled' WHERE status = 'pending'`);
    const app = workflows();
    const left = await propose(app, "60.00");
    const right = await propose(app, "60.00");
    const daily = await Promise.allSettled([
      app.confirmProposal("token", left.id, "race-daily-key-0001", randomUUID()),
      app.confirmProposal("token", right.id, "race-daily-key-0002", randomUUID()),
    ]);
    expect(daily.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const usage = await source.query(`SELECT consumed_amount::text AS consumed FROM daily_transfer_usage WHERE user_id = $1`, [userId]) as Array<{ consumed: string }>;
    expect(Number(usage[0]?.consumed).toFixed(2)).toBe("60.00");
    const winner = daily.find((item) => item.status === "fulfilled");
    const replayed = await Promise.allSettled([
      app.confirmProposal("token", left.id, "race-daily-key-0001", randomUUID()),
      app.confirmProposal("token", right.id, "race-daily-key-0002", randomUUID()),
    ]);
    expect(replayed.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const winnerProposalId = winner?.status === "fulfilled" ? winner.value.proposalId : left.id;
    await expect(app.confirmProposal("token", winnerProposalId, "race-daily-key-0003", randomUUID())).rejects.toBeInstanceOf(AccountsError);
    const store = new PostgresAccountsStore(source);
    await expect(publishPending(store, { async publish() { throw new Error("broker_down"); } }, 20, new Date().toISOString())).rejects.toThrow("broker_down");
    const pending = await source.query(`SELECT count(*)::int AS total FROM outbox_events WHERE published_at IS NULL AND event_type = 'transfer.completed'`) as Array<{ total: number }>;
    const transfers = await source.query(`SELECT count(*)::int AS total FROM transfers`) as Array<{ total: number }>;
    expect(Number(pending[0]?.total)).toBeGreaterThan(0);
    expect(Number(transfers[0]?.total)).toBeGreaterThan(0);
  });

  it("rejects a revoked recheck, an expired proposal and a foreign account", async () => {
    await source.query(`UPDATE accounts SET balance = 100.00 WHERE id = $1`, [sourceId]);
    let calls = 0;
    const app = workflows({
      async authorize() {
        calls += 1;
        if (calls > 2) {
          throw new AccountsError("SESSION_INVALID", "La sesión no es válida");
        }
        return { userId, sessionId };
      },
    });
    const proposal = await propose(app, "10.00");
    await expect(app.confirmProposal("token", proposal.id, "revoked-gate-key01", randomUUID())).rejects.toMatchObject({ code: "SESSION_INVALID" });
    const balance = await source.query(`SELECT balance::text AS balance FROM accounts WHERE id = $1`, [sourceId]) as Array<{ balance: string }>;
    expect(balance[0]?.balance).toBe("100.00");
    const fresh = workflows();
    const expired = await propose(fresh, "10.00");
    await source.query(`UPDATE transfer_proposals SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = $1`, [expired.id]);
    await expect(fresh.confirmProposal("token", expired.id, "expired-gate-key01", randomUUID())).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const other = new AccountsWorkflows(new PostgresAccountsStore(source), { async authorize() { return { userId: "00000000-0000-4000-8000-000000000199", sessionId: "00000000-0000-4000-8000-000000000198" }; } }, { now: () => new Date() }, { uuid: () => randomUUID() }, {
      perTransferDefault: "100.00", dailyDefault: "100.00", perTransferMax: "50000.00", dailyMax: "100000.00", proposalTtlSeconds: 300, resolveLimit: 5, resolveWindowSeconds: 60,
    });
    await expect(other.getAccount("token", sourceId)).rejects.toMatchObject({ code: "RESOURCE_NOT_VISIBLE" });
  });
});
