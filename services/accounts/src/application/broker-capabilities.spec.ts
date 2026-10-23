import { buildBrokerCapabilities } from "./broker-capabilities";

describe("buildBrokerCapabilities", () => {
  it("reports a missing broker URL without marking it verified", () => {
    expect(buildBrokerCapabilities("")).toEqual({
      capabilities: [{ name: "rabbitmq", status: "missing", verified: false }],
    });
  });

  it("does not echo a URL that contains a password", () => {
    const report = buildBrokerCapabilities("amqp://audit:secret@rabbitmq:5672");
    expect(report.capabilities[0].status).toBe("configured");
    expect(JSON.stringify(report)).not.toContain("secret");
  });
});
