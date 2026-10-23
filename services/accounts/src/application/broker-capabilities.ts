import { capability, presence, type Capability } from "./capabilities";

export function buildBrokerCapabilities(rabbitUrl: string): { capabilities: Capability[] } {
  return { capabilities: [capability("rabbitmq", presence(rabbitUrl))] };
}
