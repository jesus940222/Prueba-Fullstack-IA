import { toPublicErrorCode, withRetry, withTimeout } from "./resilience";

describe("resilience", () => {
  it("returns the work result before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("up"), 50)).resolves.toBe("up");
  });

  it("rejects when the work outlives the timeout", async () => {
    const pending = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(pending, 20)).rejects.toThrow("timeout");
  });

  it("retries a failed attempt and then returns the success", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("postgres://user:secret@db");
      }
      return "up";
    }, 2, 1);
    expect(result).toBe("up");
    expect(calls).toBe(2);
  });

  it("hides driver details behind a stable error code", () => {
    expect(toPublicErrorCode(new Error("timeout"))).toBe("timeout");
    expect(toPublicErrorCode(new Error("password=secret"))).toBe("dependency_unreachable");
    expect(toPublicErrorCode("down")).toBe("dependency_unreachable");
  });
});
