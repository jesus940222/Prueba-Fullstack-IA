import type { AudienceType, OfferRecord, RuleRecord } from "./records";

export interface FinancialContext {
  verifiable: boolean;
  totalBalance?: string;
  accountAgeDays?: number;
}

export type OfferDecision =
  | { eligible: true }
  | { eligible: false; reason: "inactive" | "expired" | "not_started" | "not_assigned" | "rules_unmet" | "context_unverified" };

const MONEY = /^(0|[1-9][0-9]{0,15})\.([0-9]{2})$/;

export function decideOffer(input: {
  offer: Pick<OfferRecord, "status" | "deletedAt" | "startsAt" | "endsAt" | "audienceType">;
  rules: readonly RuleRecord[];
  assigned: boolean;
  context: FinancialContext | null;
  now: Date;
}): OfferDecision {
  if (input.offer.deletedAt || input.offer.status !== "active") {
    return { eligible: false, reason: "inactive" };
  }
  const now = input.now.getTime();
  if (input.offer.startsAt && Date.parse(input.offer.startsAt) > now) {
    return { eligible: false, reason: "not_started" };
  }
  if (input.offer.endsAt && Date.parse(input.offer.endsAt) <= now) {
    return { eligible: false, reason: "expired" };
  }
  return decideAudience(input.offer.audienceType, input.rules, input.assigned, input.context);
}

function decideAudience(audience: AudienceType, rules: readonly RuleRecord[], assigned: boolean, context: FinancialContext | null): OfferDecision {
  if (audience === "general") {
    return { eligible: true };
  }
  if (audience === "direct") {
    return assigned ? { eligible: true } : { eligible: false, reason: "not_assigned" };
  }
  if (!context?.verifiable) {
    return { eligible: false, reason: "context_unverified" };
  }
  return rules.every((rule) => matches(rule, context)) ? { eligible: true } : { eligible: false, reason: "rules_unmet" };
}

function matches(rule: RuleRecord, context: FinancialContext): boolean {
  if (rule.field === "totalBalance") {
    const actual = cents(context.totalBalance);
    const expected = cents(rule.value);
    if (actual === null || expected === null) {
      return false;
    }
    return compare(actual, expected, rule.operator);
  }
  if (!Number.isInteger(context.accountAgeDays) || !/^(0|[1-9][0-9]{0,5})$/.test(rule.value)) {
    return false;
  }
  return compare(BigInt(context.accountAgeDays ?? 0), BigInt(rule.value), rule.operator);
}

function cents(value: string | undefined): bigint | null {
  const match = value ? MONEY.exec(value) : null;
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}

function compare(actual: bigint, expected: bigint, operator: RuleRecord["operator"]): boolean {
  if (operator === "eq") {
    return actual === expected;
  }
  if (operator === "gte") {
    return actual >= expected;
  }
  return actual <= expected;
}
