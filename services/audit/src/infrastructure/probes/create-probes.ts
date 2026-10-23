import type { Probe } from "../../application/readiness";
import type { AppEnv } from "../config/env";
import { openMongo } from "./mongo.factory";
import { probeMongo } from "./mongo.probe";
import { openRabbit } from "./rabbit.factory";
import { probeRabbit } from "./rabbit.probe";

export function createProbes(env: AppEnv): Probe[] {
  return [
    { name: "mongo", required: true, check: () => probeMongo(() => openMongo(env.databaseUrl)) },
    { name: "rabbitmq", required: false, check: () => probeRabbit(env.rabbitUrl, () => openRabbit(env.rabbitUrl)) },
  ];
}
