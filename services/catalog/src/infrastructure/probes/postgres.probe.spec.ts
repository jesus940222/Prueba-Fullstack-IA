import { probePostgres, type SqlClient } from "./postgres.probe";

describe("probePostgres", () => {
  it("returns up after a successful SELECT 1", async () => {
    const client: SqlClient = { query: async () => [{ ok: 1 }], end: async () => undefined };
    await expect(probePostgres(async () => client)).resolves.toBe("up");
  });

  it("closes the client and retries when the first attempt fails", async () => {
    let opened = 0;
    const end = jest.fn(async () => undefined);
    await expect(
      probePostgres(async () => {
        opened += 1;
        if (opened === 1) {
          return {
            query: async () => {
              throw new Error("connection reset");
            },
            end,
          };
        }
        return { query: async () => [], end };
      }),
    ).resolves.toBe("up");
    expect(opened).toBe(2);
    expect(end).toHaveBeenCalled();
  });
});
