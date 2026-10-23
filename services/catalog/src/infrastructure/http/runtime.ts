import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { CatalogWorkflows } from "../../application/catalog-workflows";
import type { AppEnv } from "../config/env";
import { startOutboxPublisher } from "../messaging/outbox-publisher";
import { PostgresCatalogStore } from "../persistence/postgres-catalog-store";
import { mountCatalog, type CatalogHttpDependencies } from "./catalog-handler";
import { createAccessAuthorizer, createAccountsContext } from "./service-clients";

export function mountCatalogRuntime(app: Parameters<typeof mountCatalog>[0], env: AppEnv, dataSource: DataSource): () => void {
  const store = new PostgresCatalogStore(dataSource);
  const workflows = new CatalogWorkflows(
    store,
    createAccessAuthorizer(env.accessAuthorizeUrl, env.serviceSecret),
    createAccountsContext(env.accountsEligibilityUrl, env.serviceSecret),
    { now: () => new Date() },
    { uuid: () => randomUUID() },
  );
  const http: CatalogHttpDependencies = {
    workflows,
    pageDefault: integer(env.credentials.PAGE_SIZE_DEFAULT),
    pageMax: integer(env.credentials.PAGE_SIZE_MAX),
  };
  mountCatalog(app, http);
  return startOutboxPublisher(store, env.rabbitUrl);
}

function integer(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid_integer");
  }
  return Number(value);
}
