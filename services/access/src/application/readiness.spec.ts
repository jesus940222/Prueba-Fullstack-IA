import { ReadinessService, type Probe } from "./readiness";

function probe(name: string, required: boolean, check: Probe["check"]): Probe {
  return { name, required, check };
}

describe("ReadinessService", () => {
  it("reports ok when every probe is up", async () => {
    const service = new ReadinessService("access", [probe("postgres", true, async () => "up")]);
    await expect(service.execute()).resolves.toMatchObject({ status: "ok" });
  });

  it("reports unavailable when a required dependency is down", async () => {
    const service = new ReadinessService("access", [
      probe("postgres", true, async () => "down"),
      probe("redis", false, async () => "up"),
    ]);
    const report = await service.execute();
    expect(report.status).toBe("unavailable");
  });

  it("reports degraded when only an optional dependency is down or not configured", async () => {
    const service = new ReadinessService("access", [
      probe("postgres", true, async () => "up"),
      probe("redis", false, async () => "not_configured"),
    ]);
    await expect(service.execute()).resolves.toMatchObject({ status: "degraded" });
  });

  it("publishes a stable error code and does not copy the driver message", async () => {
    const service = new ReadinessService("access", [
      probe("postgres", true, async () => {
        throw new Error("connect ECONNREFUSED password=secret");
      }),
    ]);
    const report = await service.execute();
    expect(report.checks[0].errorCode).toBe("dependency_unreachable");
    expect(JSON.stringify(report)).not.toContain("secret");
  });
});
