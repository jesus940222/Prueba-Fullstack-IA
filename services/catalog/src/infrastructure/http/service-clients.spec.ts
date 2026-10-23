import { CatalogError } from "../../domain/catalog-error";
import { principalFromAuthorize } from "../../application/access-decision";
import { createAccountsContext, createAccessAuthorizer } from "./service-clients";

describe("catalog service clients", () => {
  const secret = "catalog-secret-must-be-32-chars!!";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps an unverifiable context and a missing customer without granting access", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({ status: 200, json: async () => ({ verifiable: false, customerId: null }) } as Response);
    const accounts = createAccountsContext("http://accounts:3002", secret);
    expect(await accounts.eligibility("00000000-0000-4000-8000-0000000000c1", ["totalBalance"])).toEqual({ verifiable: false });
    expect(await accounts.customerIdForUser("00000000-0000-4000-8000-000000000001")).toBeNull();
  });

  it("fails closed when Cuentas or Acceso do not answer", async () => {
    const accounts = createAccountsContext("http://accounts:3002", "short");
    await expect(accounts.eligibility("00000000-0000-4000-8000-0000000000c1", [])).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await expect(createAccountsContext("http://accounts:3002", secret).eligibility("00000000-0000-4000-8000-0000000000c1", ["totalBalance"])).rejects.toBeInstanceOf(CatalogError);
    jest.spyOn(globalThis, "fetch").mockResolvedValue({ status: 503, json: async () => ({}) } as Response);
    await expect(createAccountsContext("http://accounts:3002/", secret).customerIdForUser("00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    await expect(createAccessAuthorizer("http://access:3001", "short").authorize("token", "products:read", false)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    jest.spyOn(globalThis, "fetch").mockResolvedValue({ status: 401, json: async () => ({}) } as Response);
    await expect(createAccessAuthorizer("http://access:3001", secret).authorize("token", "products:read", false)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("reads an allow decision and a verifiable balance", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("authorize")) {
        return { status: 200, json: async () => ({ decision: "allow", principal: { userId: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000002" } }) } as Response;
      }
      return { status: 200, json: async () => ({ verifiable: true, attributes: { totalBalance: "10.00", accountAgeDays: 3 } }) } as Response;
    });
    expect((await createAccessAuthorizer("http://access:3001", secret).authorize("token", "products:read", false)).userId).toBe("00000000-0000-4000-8000-000000000001");
    expect(await createAccountsContext("http://accounts:3002", secret).eligibility("00000000-0000-4000-8000-0000000000c1", ["totalBalance", "accountAgeDays"])).toEqual({
      verifiable: true,
      totalBalance: "10.00",
      accountAgeDays: 3,
    });
    expect(() => principalFromAuthorize(200, { decision: "deny", reasonCode: "recent_verification_required" })).toThrow(CatalogError);
  });

  it("denies when the decision is not allow", () => {
    expect(() => principalFromAuthorize(200, { decision: "deny" })).toThrow(CatalogError);
    expect(() => principalFromAuthorize(503, {})).toThrow(CatalogError);
    expect(() => principalFromAuthorize(200, { decision: "allow" })).toThrow(CatalogError);
  });
});
