import { principalFromAuthorize } from "./access-decision";
import { AuditError } from "../domain/audit-error";

describe("audit access decision", () => {
  it("accepts an allow and rejects the other decisions", () => {
    expect(principalFromAuthorize(200, { decision: "allow", principal: { userId: "u", sessionId: "s" } })).toEqual({ userId: "u", sessionId: "s" });
    expect(() => principalFromAuthorize(401, {})).toThrow(AuditError);
    expect(() => principalFromAuthorize(503, {})).toThrow(AuditError);
    expect(() => principalFromAuthorize(200, { decision: "deny" })).toThrow(AuditError);
  });
});
