import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { AccountsWorkflows } from "../../application/accounts-workflows";
import type { AppEnv } from "../config/env";
import { startOutboxPublisher } from "../messaging/outbox-publisher";
import { PostgresAccountsStore } from "../persistence/postgres-accounts-store";
import { createAccessAuthorizer } from "./access-authorizer";
import { mountAccounts, type AccountsHttpDependencies } from "./accounts-handler";

export function mountAccountsRuntime(app: Parameters<typeof mountAccounts>[0], env: AppEnv, dataSource: DataSource): () => void {
  const store = new PostgresAccountsStore(dataSource);
  const workflows = new AccountsWorkflows(
    store,
    createAccessAuthorizer(env.accessAuthorizeUrl, env.serviceSecret),
    { now: () => new Date() },
    { uuid: () => randomUUID() },
    {
      perTransferDefault: env.credentials.TRANSFER_LIMIT_PER_OPERATION,
      dailyDefault: env.credentials.TRANSFER_LIMIT_DAILY,
      perTransferMax: env.credentials.TRANSFER_LIMIT_PER_OPERATION_MAX,
      dailyMax: env.credentials.TRANSFER_LIMIT_DAILY_MAX,
      proposalTtlSeconds: integer(env.credentials.TRANSFER_PROPOSAL_TTL),
      resolveLimit: integer(env.credentials.RESOLVE_RATE_LIMIT),
      resolveWindowSeconds: integer(env.credentials.RESOLVE_RATE_WINDOW),
    },
  );
  const http: AccountsHttpDependencies = {
    workflows,
    pageDefault: integer(env.credentials.PAGE_SIZE_DEFAULT),
    pageMax: integer(env.credentials.PAGE_SIZE_MAX),
    cursorDefault: integer(env.credentials.CURSOR_LIMIT_DEFAULT),
    cursorMax: integer(env.credentials.CURSOR_LIMIT_MAX),
    eligibilitySecrets: env.eligibilitySecrets,
  };
  mountAccounts(app, http);
  return startOutboxPublisher(store, env.rabbitUrl);
}

function integer(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid_integer");
  }
  return Number(value);
}
