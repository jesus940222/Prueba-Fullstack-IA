import type { Probe } from "../../application/readiness";
import type { AppEnv } from "../config/env";
import { openPostgres } from "./postgres.factory";
import { probePostgres } from "./postgres.probe";
import { openRabbit } from "./rabbit.factory";
import { probeRabbit } from "./rabbit.probe";
import { openRedis } from "./redis.factory";
import { probeRedis } from "./redis.probe";
import { openTcp } from "./tcp.factory";
import { probeTcpEndpoint } from "./tcp.probe";

export function createProbes(env: AppEnv): Probe[] {
  return [
    { name: "postgres", required: true, check: () => probePostgres(() => openPostgres(env.databaseUrl)) },
    { name: "redis", required: false, check: () => probeRedis(() => openRedis(env.redisUrl)) },
    { name: "rabbitmq", required: false, check: () => probeRabbit(env.rabbitUrl, () => openRabbit(env.rabbitUrl)) },
    { name: "smtp", required: false, check: () => probeTcpEndpoint(env.smtpUrl, openTcp) },
  ];
}
