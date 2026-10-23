import { probeRabbit } from "./rabbit.probe";

describe("probeRabbit", () => {
  it("stays not configured when the service has no broker URL", async () => {
    await expect(probeRabbit("", async () => ({ close: async () => undefined }))).resolves.toBe("not_configured");
  });

  it("returns up after the connection closes", async () => {
    await expect(probeRabbit("amqp://audit@rabbitmq:5672", async () => ({ close: async () => undefined }))).resolves.toBe(
      "up",
    );
  });
});
