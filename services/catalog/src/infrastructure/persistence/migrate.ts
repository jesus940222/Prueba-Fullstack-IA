import { loadEnv } from "../config/env";
import { writeLog } from "../logging/write-log";
import { createDataSource } from "./data-source";

import { seedCatalog } from "./seed";

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const dataSource = createDataSource(env.databaseUrl);
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: "all" });
    await seedCatalog(dataSource);
    process.stdout.write(`${JSON.stringify({ applied: applied.map((migration) => migration.name) })}\n`);
    writeLog({ level: "info", event: "migration_job_finished", dependency: "postgres" });
  } finally {
    await dataSource.destroy();
  }
}

main().catch(() => {
  writeLog({ level: "error", event: "migration_job_failed", dependency: "postgres", errorCode: "migration_failed" });
  process.exit(1);
});
