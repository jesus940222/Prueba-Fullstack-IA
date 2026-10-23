import { toPublicErrorCode, withTimeout } from "./resilience";

export type ProbeStatus = "up" | "down" | "not_configured";

export interface Probe {
  name: string;
  required: boolean;
  check: () => Promise<ProbeStatus>;
}

export interface CheckReport {
  name: string;
  status: ProbeStatus;
  required: boolean;
  errorCode?: "timeout" | "dependency_unreachable";
}

export interface ReadinessReport {
  status: "ok" | "degraded" | "unavailable";
  service: string;
  checks: CheckReport[];
}

export class UnavailableReadiness extends Error {
  constructor(readonly report: ReadinessReport) {
    super("unavailable");
    this.name = "UnavailableReadiness";
  }
}

export class ReadinessService {
  constructor(
    private readonly serviceName: string,
    private readonly probes: Probe[],
    private readonly timeoutMs = 2000,
  ) {}

  async execute(): Promise<ReadinessReport> {
    const checks: CheckReport[] = [];
    for (const probe of this.probes) {
      try {
        const status = await withTimeout(probe.check(), this.timeoutMs);
        checks.push({ name: probe.name, status, required: probe.required });
      } catch (error) {
        checks.push({
          name: probe.name,
          status: "down",
          required: probe.required,
          errorCode: toPublicErrorCode(error),
        });
      }
    }
    const requiredDown = checks.some((check) => check.required && check.status !== "up");
    const optionalDown = checks.some((check) => !check.required && check.status !== "up");
    return {
      status: requiredDown ? "unavailable" : optionalDown ? "degraded" : "ok",
      service: this.serviceName,
      checks,
    };
  }
}
