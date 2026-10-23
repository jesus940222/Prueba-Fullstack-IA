import { AccountsError } from "../domain/accounts-error";
import { principalFromAuthorize } from "./access-decision";

describe("access decisions", () => {
  it("accepts an allow and rejects revocation, a stale verification and an outage", () => {
    expect(principalFromAuthorize(200, { decision: "allow", principal: { userId: "user", sessionId: "session" } })).toEqual({ userId: "user", sessionId: "session" });
    expect(thrown(() => principalFromAuthorize(401, {})).code).toBe("SESSION_INVALID");
    expect(thrown(() => principalFromAuthorize(200, { decision: "deny", reasonCode: "recent_verification_required" })).code).toBe("RECENT_VERIFICATION_REQUIRED");
    expect(thrown(() => principalFromAuthorize(200, { decision: "deny", reasonCode: "permission" })).code).toBe("PERMISSION_DENIED");
    expect(thrown(() => principalFromAuthorize(503, {})).code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(thrown(() => principalFromAuthorize(200, null)).code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(thrown(() => principalFromAuthorize(200, { decision: "allow", principal: {} })).code).toBe("PERMISSION_DENIED");
  });
});

function thrown(run: () => void): AccountsError {
  try {
    run();
  } catch (error) {
    if (error instanceof AccountsError) {
      return error;
    }
  }
  throw new Error("expected_accounts_error");
}
