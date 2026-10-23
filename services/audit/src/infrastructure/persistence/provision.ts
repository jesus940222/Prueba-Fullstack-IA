import mongoose from "mongoose";
import { loadEnv } from "../config/env";
import { writeLog } from "../logging/write-log";

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const connection = await mongoose.createConnection(env.migratorUrl, { serverSelectionTimeoutMS: 5000 }).asPromise();
  try {
    const events = connection.collection("events");
    await events.createIndex({ event_id: 1 }, { unique: true, name: "event_id_unique" });
    await events.createIndex({ correlation_id: 1 }, { name: "correlation_id" });
    await events.createIndex({ occurred_at: 1 }, { name: "occurred_at" });
    await events.createIndex({ actor_id: 1 }, { name: "actor_id" });
    await events.createIndex({ event_type: 1 }, { name: "event_type" });
    process.stdout.write(`${JSON.stringify({ indexes: ["event_id_unique", "correlation_id", "occurred_at", "actor_id", "event_type"] })}\n`);
    writeLog({ level: "info", event: "migration_job_finished", dependency: "mongo" });
  } finally {
    await connection.close();
  }
}

main().catch(() => {
  writeLog({ level: "error", event: "migration_job_failed", dependency: "mongo", errorCode: "migration_failed" });
  process.exit(1);
});
