import { Client } from "pg";
import type { SqlClient } from "./postgres.probe";

export async function openPostgres(url: string): Promise<SqlClient> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 1000 });
  await client.connect();
  return client;
}
