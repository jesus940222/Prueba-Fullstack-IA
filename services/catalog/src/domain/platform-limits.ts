export interface PlatformLimits {
  transferPerOperation: string;
  transferDaily: string;
  transferPerOperationMax: string;
  transferDailyMax: string;
  proposalTtl: number;
  recentVerificationTtl: number;
  accessTokenTtl: number;
  sessionAbsoluteTtl: number;
  sessionIdleTtl: number;
  emailCodeTtl: number;
  emailCodeAttempts: number;
  pageDefault: number;
  pageMax: number;
  cursorDefault: number;
  cursorMax: number;
  budgetRun: string;
  budgetUser: string;
  budgetGlobal: string;
  warnPercents: number[];
  alertCooldown: number;
  maxSteps: number;
  runTimeout: number;
  vectorSize: number;
}

function cents(value: string): number {
  if (!/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(value)) {
    throw new Error("invalid_decimal");
  }
  const [whole, fraction] = value.split(".");
  return Number(whole) * 100 + Number(fraction);
}

export function assertPlatformLimits(input: PlatformLimits): void {
  const perOperation = cents(input.transferPerOperation);
  const daily = cents(input.transferDaily);
  const perOperationMax = cents(input.transferPerOperationMax);
  const dailyMax = cents(input.transferDailyMax);
  if (perOperation <= 0 || daily <= 0 || perOperation > daily) {
    throw new Error("invalid_transfer_limits");
  }
  if (perOperationMax <= 0 || dailyMax <= 0 || perOperation > perOperationMax || daily > dailyMax) {
    throw new Error("invalid_transfer_ceilings");
  }
  if (input.pageDefault < 1 || input.pageMax > 100 || input.pageDefault > input.pageMax) {
    throw new Error("invalid_page_size");
  }
  if (input.cursorDefault < 1 || input.cursorMax > 50 || input.cursorDefault > input.cursorMax) {
    throw new Error("invalid_cursor_size");
  }
  const run = cents(input.budgetRun);
  const user = cents(input.budgetUser);
  const global = cents(input.budgetGlobal);
  if (run <= 0 || user <= 0 || global <= 0 || run > user || user > global) {
    throw new Error("invalid_ai_budget");
  }
  if (input.warnPercents.length === 0 || input.warnPercents.some((item) => item <= 0 || item > 100)) {
    throw new Error("invalid_alert_thresholds");
  }
  if (input.alertCooldown <= 0 || input.maxSteps <= 0 || input.runTimeout <= 0) {
    throw new Error("invalid_ai_runtime");
  }
  if (input.vectorSize !== 3072) {
    throw new Error("invalid_vector_size");
  }
  const durations = [
    input.proposalTtl,
    input.recentVerificationTtl,
    input.accessTokenTtl,
    input.sessionAbsoluteTtl,
    input.sessionIdleTtl,
    input.emailCodeTtl,
    input.emailCodeAttempts,
  ];
  if (durations.some((item) => item <= 0) || input.sessionIdleTtl > input.sessionAbsoluteTtl) {
    throw new Error("invalid_session_ttl");
  }
}
