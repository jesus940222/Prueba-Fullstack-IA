import { CatalogError, CATALOG_ERROR_CODES, httpStatusFor } from "./catalog-error";
import { decideOffer } from "./eligibility";
import { parsePageQuery } from "./pagination";
import type { OfferRecord, RuleRecord } from "./records";

const now = new Date("2026-10-21T18:00:00.000Z");

function offer(overrides: Partial<OfferRecord> = {}): OfferRecord {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    productId: "00000000-0000-4000-8000-000000000020",
    code: "oferta",
    title: "Oferta",
    description: "",
    benefitType: "information",
    benefitValue: "",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2027-01-01T00:00:00.000Z",
    priority: 1,
    audienceType: "general",
    status: "active",
    deletedAt: null,
    deletedBy: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function rule(overrides: Partial<RuleRecord> = {}): RuleRecord {
  return { id: "00000000-0000-4000-8000-000000000030", offerId: offer().id, field: "totalBalance", operator: "gte", value: "20000.00", ...overrides };
}

describe("catalog eligibility", () => {
  it("grants a current general offer and refuses expired, future and inactive ones", () => {
    expect(decideOffer({ offer: offer(), rules: [], assigned: false, context: null, now }).eligible).toBe(true);
    expect(decideOffer({ offer: offer({ endsAt: "2026-03-01T00:00:00.000Z" }), rules: [], assigned: false, context: null, now })).toEqual({ eligible: false, reason: "expired" });
    expect(decideOffer({ offer: offer({ startsAt: "2026-12-01T00:00:00.000Z" }), rules: [], assigned: false, context: null, now })).toEqual({ eligible: false, reason: "not_started" });
    expect(decideOffer({ offer: offer({ status: "disabled" }), rules: [], assigned: false, context: null, now })).toEqual({ eligible: false, reason: "inactive" });
    expect(decideOffer({ offer: offer({ deletedAt: now.toISOString() }), rules: [], assigned: false, context: null, now })).toEqual({ eligible: false, reason: "inactive" });
  });

  it("does not grant a rules offer when the context is missing or the balance fails", () => {
    const rules = [rule(), rule({ id: "00000000-0000-4000-8000-000000000031", field: "accountAgeDays", operator: "lte", value: "400" })];
    expect(decideOffer({ offer: offer({ audienceType: "rules" }), rules, assigned: false, context: null, now })).toEqual({ eligible: false, reason: "context_unverified" });
    expect(decideOffer({ offer: offer({ audienceType: "rules" }), rules, assigned: false, context: { verifiable: false }, now })).toEqual({ eligible: false, reason: "context_unverified" });
    expect(decideOffer({ offer: offer({ audienceType: "rules" }), rules, assigned: false, context: { verifiable: true, totalBalance: "19999.99", accountAgeDays: 10 }, now })).toEqual({ eligible: false, reason: "rules_unmet" });
    expect(decideOffer({ offer: offer({ audienceType: "rules" }), rules, assigned: false, context: { verifiable: true, totalBalance: "20000.00", accountAgeDays: 400 }, now }).eligible).toBe(true);
    expect(decideOffer({ offer: offer({ audienceType: "rules" }), rules: [rule({ operator: "eq", value: "10.00" })], assigned: false, context: { verifiable: true, totalBalance: "10.00" }, now }).eligible).toBe(true);
    expect(decideOffer({ offer: offer({ audienceType: "rules" }), rules: [rule({ value: "no-es-importe" })], assigned: false, context: { verifiable: true, totalBalance: "10.00" }, now })).toEqual({ eligible: false, reason: "rules_unmet" });
    expect(decideOffer({ offer: offer({ audienceType: "rules" }), rules: [rule({ field: "accountAgeDays", value: "10.5" })], assigned: false, context: { verifiable: true, accountAgeDays: 10 }, now })).toEqual({ eligible: false, reason: "rules_unmet" });
  });

  it("grants a direct offer only with an active assignment", () => {
    expect(decideOffer({ offer: offer({ audienceType: "direct" }), rules: [], assigned: false, context: null, now })).toEqual({ eligible: false, reason: "not_assigned" });
    expect(decideOffer({ offer: offer({ audienceType: "direct" }), rules: [], assigned: true, context: { verifiable: false }, now }).eligible).toBe(true);
  });

  it("rejects an invalid page and maps every error code", () => {
    expect(parsePageQuery({ pageDefault: 20, pageMax: 100 }).pageSize).toBe(20);
    expect(() => parsePageQuery({ page: "0", pageDefault: 20, pageMax: 100 })).toThrow(CatalogError);
    expect(() => parsePageQuery({ pageSize: "101", pageDefault: 20, pageMax: 100 })).toThrow(CatalogError);
    expect(() => parsePageQuery({ sort: "name", pageDefault: 20, pageMax: 100 })).toThrow(CatalogError);
    const statuses = new Set(CATALOG_ERROR_CODES.map((code) => httpStatusFor(code)));
    expect(statuses).toEqual(new Set([401, 403, 404, 409, 422, 429, 503]));
  });
});
