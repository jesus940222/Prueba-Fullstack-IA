import { probeMongo } from "./mongo.probe";

describe("probeMongo", () => {
  it("returns up when ping succeeds and always closes", async () => {
    const close = jest.fn(async () => undefined);
    await expect(probeMongo(async () => ({ ping: async () => undefined, close }))).resolves.toBe("up");
    expect(close).toHaveBeenCalled();
  });
});
