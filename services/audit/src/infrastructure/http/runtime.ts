import { randomUUID } from "node:crypto";
import type { Connection } from "mongoose";
import mongoose from "mongoose";
import { AuditWorkflows } from "../../application/audit-workflows";
import type { AppEnv } from "../config/env";
import { writeLog } from "../logging/write-log";
import { startAuditConsumer } from "../messaging/audit-consumer";
import { MongoAuditStore } from "../persistence/mongo-audit-store";
import { createAccessAuthorizer } from "./access-authorizer";
import { mountAudit, type AuditHttpDependencies } from "./audit-handler";

export function mountAuditRuntime(app: Parameters<typeof mountAudit>[0], env: AppEnv, connection: Connection): () => void {
  const store = new MongoAuditStore(connection.collection("events"));
  const workflows = new AuditWorkflows(
    store,
    createAccessAuthorizer(env.accessAuthorizeUrl, env.serviceSecret),
    { now: () => new Date() },
    { uuid: () => randomUUID() },
    env.rangeMaxDays,
  );
  const http: AuditHttpDependencies = {
    workflows,
    pageDefault: integer(env.credentials.PAGE_SIZE_DEFAULT),
    pageMax: integer(env.credentials.PAGE_SIZE_MAX),
  };
  mountAudit(app, http);
  if (env.consumerUrl === "" || env.rabbitUrl === "") {
    return () => undefined;
  }
  const consumer = mongoose.createConnection(env.consumerUrl, { serverSelectionTimeoutMS: 5000 });
  void consumer.asPromise().then(() => {
    startAuditConsumer(env.rabbitUrl, new MongoAuditStore(consumer.collection("events")), env.consumeAttempts);
    writeLog({ level: "info", event: "audit_consumer_connecting" });
  }).catch(() => {
    writeLog({ level: "error", event: "audit_consumer_unavailable", dependency: "mongo", errorCode: "consumer_unavailable" });
  });
  return () => {
    void consumer.close();
  };
}

function integer(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid_integer");
  }
  return Number(value);
}
