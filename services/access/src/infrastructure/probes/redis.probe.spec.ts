import { probeRedis } from "./redis.probe";

describe("probeRedis", () => {
  it("accepts only PONG", async () => {
    await expect(
      probeRedis(async () => ({ ping: async () => "PONG", quit: async () => undefined })),
    ).resolves.toBe("up");
    await expect(probeRedis(async () => ({ ping: async () => "NO", quit: async () => undefined }))).rejects.toThrow(
      "unexpected_ping",
    );
  });
});
