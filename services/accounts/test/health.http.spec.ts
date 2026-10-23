import { Test } from "@nestjs/testing";
import { HealthController, CAPABILITY_SOURCE } from "../src/presentation/health.controller";
import { SafeExceptionFilter } from "../src/presentation/readiness.filter";
import { correlationMiddleware } from "../src/presentation/correlation.middleware";
import { ReadinessService } from "../src/application/readiness";

describe("health HTTP", () => {
  async function listen(report: { status: "ok" | "degraded" | "unavailable"; service: string; checks: [] }) {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: ReadinessService, useValue: { execute: async () => report } },
        { provide: CAPABILITY_SOURCE, useValue: { current: () => ({ capabilities: [] }) } },
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    app.use(correlationMiddleware);
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { app, port };
  }

  it("returns 503 with the readiness body when a required dependency is down", async () => {
    const { app, port } = await listen({ status: "unavailable", service: "access", checks: [] });
    const response = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "unavailable" });
    await app.close();
  });

  it("returns 200 when the service is degraded and echoes a valid correlation id", async () => {
    const { app, port } = await listen({ status: "degraded", service: "access", checks: [] });
    const correlationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const response = await fetch(`http://127.0.0.1:${port}/ready`, {
      headers: { "x-correlation-id": correlationId },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const capabilities = await fetch(`http://127.0.0.1:${port}/capabilities`);
    expect(health.status).toBe(200);
    expect(capabilities.status).toBe(200);
    await app.close();
  });
});
