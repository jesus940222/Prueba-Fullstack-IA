import type { Probe } from "../../application/readiness";
import type { AppEnv } from "../config/env";
import { openPostgres } from "./postgres.factory";
import { probePostgres } from "./postgres.probe";
import { openRabbit } from "./rabbit.factory";
import { probeRabbit } from "./rabbit.probe";

export function createProbes(env: AppEnv): Probe[] {
  return [
    { name: "postgres", required: true, check: () => probePostgres(() => openPostgres(env.databaseUrl)) },
    { name: "rabbitmq", required: false, check: () => probeRabbit(env.rabbitUrl, () => openRabbit(env.rabbitUrl)) },
  ];
}
