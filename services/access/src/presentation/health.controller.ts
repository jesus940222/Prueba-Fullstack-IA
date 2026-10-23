import { Controller, Get, Inject } from "@nestjs/common";
import type { Capability } from "../application/capabilities";
import { ReadinessService, UnavailableReadiness } from "../application/readiness";

export interface CapabilitySource {
  current(): { capabilities: Capability[] };
}

export const CAPABILITY_SOURCE = Symbol("CAPABILITY_SOURCE");

@Controller()
export class HealthController {
  constructor(
    private readonly readiness: ReadinessService,
    @Inject(CAPABILITY_SOURCE) private readonly capabilities: CapabilitySource,
  ) {}

  @Get("health")
  health(): { status: "ok"; service: string } {
    return { status: "ok", service: process.env.SERVICE_NAME ?? "unknown" };
  }

  @Get("ready")
  async ready() {
    const report = await this.readiness.execute();
    if (report.status === "unavailable") {
      throw new UnavailableReadiness(report);
    }
    return report;
  }

  @Get("capabilities")
  capabilitiesReport() {
    return this.capabilities.current();
  }
}
