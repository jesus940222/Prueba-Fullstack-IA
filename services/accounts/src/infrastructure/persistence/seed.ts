import { createHash } from "node:crypto";
import type { DataSource } from "typeorm";
import { Money } from "../../domain/money";

const OPENED = "2026-01-15T16:00:00.000Z";

const PEOPLE = [
  {
    email: "ana.cliente@portal.local",
    number: "C-1001",
    givenName: "Ana",
    familyName: "Cliente",
    accounts: [
      { number: "1000000000000001", name: "Nómina", opening: "25000.00", purchase: "150.00" },
      { number: "1000000000000002", name: "Ahorro", opening: "8000.00", purchase: null },
    ],
  },
  {
    email: "bruno.soporte@portal.local",
    number: "C-1002",
    givenName: "Bruno",
    familyName: "Soporte",
    accounts: [
      { number: "1000000000000003", name: "Operativa", opening: "15000.00", purchase: null },
      { number: "1000000000000004", name: "Reserva", opening: "4000.00", purchase: null },
    ],
  },
  {
    email: "elena.gestor@portal.local",
    number: "C-1003",
    givenName: "Elena",
    familyName: "Gestor",
    accounts: [
      { number: "1000000000000005", name: "Personal", opening: "12000.00", purchase: null },
      { number: "1000000000000006", name: "Apartado", opening: "3000.00", purchase: null },
    ],
  },
] as const;

export async function seedAccounts(dataSource: DataSource, limits: { perTransfer: string; daily: string }): Promise<void> {
  for (const person of PEOPLE) {
    const customerId = stableId(`customer:${person.number}`);
    const userId = stableId(`user:${person.email}`);
    await dataSource.query(
      `INSERT INTO customers (id, customer_number, given_name, family_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $5) ON CONFLICT (customer_number) DO NOTHING`,
      [customerId, person.number, person.givenName, person.familyName, OPENED],
    );
    await dataSource.query(
      `INSERT INTO user_customers (id, user_id, customer_id, status, created_at)
       VALUES ($1, $2, $3, 'active', $4) ON CONFLICT (user_id) DO NOTHING`,
      [stableId(`user-customer:${person.email}`), userId, customerId, OPENED],
    );
    await dataSource.query(
      `INSERT INTO user_transfer_limits (id, user_id, currency, per_transfer_limit, daily_limit, updated_by, updated_at)
       VALUES ($1, $2, 'MXN', $3, $4, $2, $5) ON CONFLICT (user_id) DO NOTHING`,
      [stableId(`limits:${person.email}`), userId, limits.perTransfer, limits.daily, OPENED],
    );
    for (const account of person.accounts) {
      const accountId = stableId(`account:${account.number}`);
      const balance = account.purchase === null ? account.opening : Money.parse(account.opening).subtract(Money.parse(account.purchase)).format();
      await dataSource.query(
        `INSERT INTO accounts (id, customer_id, account_number, name, currency, status, balance, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'MXN', 'active', $5, $6, $6) ON CONFLICT (account_number) DO NOTHING`,
        [accountId, customerId, account.number, account.name, balance, OPENED],
      );
      await dataSource.query(
        `INSERT INTO movements (id, account_id, transfer_id, type, direction, amount, currency, balance_after, recorded_at)
         SELECT $1, $2, NULL, 'opening', 'in', $3, 'MXN', $3, $4
         WHERE NOT EXISTS (SELECT 1 FROM movements WHERE id = $1)`,
        [stableId(`movement:opening:${account.number}`), accountId, account.opening, OPENED],
      );
      if (account.purchase) {
        await dataSource.query(
          `INSERT INTO movements (id, account_id, transfer_id, type, direction, amount, currency, balance_after, recorded_at)
           SELECT $1, $2, NULL, 'purchase', 'out', $3, 'MXN', $4, $5
           WHERE NOT EXISTS (SELECT 1 FROM movements WHERE id = $1)`,
          [stableId(`movement:purchase:${account.number}`), accountId, account.purchase, balance, "2026-02-02T18:00:00.000Z"],
        );
      }
    }
  }
  const ana = stableId("customer:C-1001");
  const saved = [
    ["Bruno", "1000000000000003"],
    ["Elena", "1000000000000005"],
  ] as const;
  for (const [alias, number] of saved) {
    await dataSource.query(
      `INSERT INTO beneficiaries (id, customer_id, destination_account_id, alias, status, created_at, updated_at)
       SELECT $1, $2, $3, $4, 'active', $5, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM beneficiaries WHERE customer_id = $2 AND destination_account_id = $3 AND deleted_at IS NULL
       )`,
      [stableId(`beneficiary:${alias}`), ana, stableId(`account:${number}`), alias, OPENED],
    );
  }
}

export function stableId(name: string): string {
  const hex = createHash("sha256").update(`portal:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
