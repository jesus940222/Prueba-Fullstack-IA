import { buildBrokerCapabilities } from "../../application/broker-capabilities";
import type { AppEnv } from "../config/env";

export function buildCapabilities(env: AppEnv) {
  return buildBrokerCapabilities(env.rabbitUrl);
}
