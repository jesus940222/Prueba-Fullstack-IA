import { assertPlatformLimits, type PlatformLimits } from "./platform-limits";

function sample(): PlatformLimits {
  return {
    transferPerOperation: "10000.00",
    transferDaily: "10000.00",
    transferPerOperationMax: "50000.00",
    transferDailyMax: "100000.00",
    proposalTtl: 300,
    recentVerificationTtl: 300,
    accessTokenTtl: 600,
    sessionAbsoluteTtl: 28800,
    sessionIdleTtl: 1800,
    emailCodeTtl: 300,
    emailCodeAttempts: 5,
    pageDefault: 20,
    pageMax: 100,
    cursorDefault: 20,
    cursorMax: 50,
    budgetRun: "1.00",
    budgetUser: "5.00",
    budgetGlobal: "25.00",
    warnPercents: [80, 100],
    alertCooldown: 1800,
    maxSteps: 8,
    runTimeout: 60,
    vectorSize: 3072,
  };
}

describe("assertPlatformLimits", () => {
  it("accepts the documented demonstration values", () => {
    expect(() => assertPlatformLimits(sample())).not.toThrow();
  });

  it("rejects an operation limit above the daily limit", () => {
    expect(() => assertPlatformLimits({ ...sample(), transferPerOperation: "10000.01" })).toThrow(
      "invalid_transfer_limits",
    );
  });

  it("rejects a limit above its ceiling", () => {
    expect(() => assertPlatformLimits({ ...sample(), transferPerOperationMax: "1000.00" })).toThrow(
      "invalid_transfer_ceilings",
    );
  });

  it("rejects a page size outside the contract", () => {
    expect(() => assertPlatformLimits({ ...sample(), pageMax: 101 })).toThrow("invalid_page_size");
  });

  it("rejects a vector size other than the selected embedding", () => {
    expect(() => assertPlatformLimits({ ...sample(), vectorSize: 1536 })).toThrow("invalid_vector_size");
  });

  it("rejects a non-decimal money amount", () => {
    expect(() => assertPlatformLimits({ ...sample(), budgetRun: "1" })).toThrow("invalid_decimal");
  });
});
