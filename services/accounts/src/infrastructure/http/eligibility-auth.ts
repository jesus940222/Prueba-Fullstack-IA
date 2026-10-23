import { jwtVerify } from "jose";
import { AccountsError } from "../../domain/accounts-error";

const CALLERS = ["catalog", "ai"] as const;

export async function assertEligibilityCaller(authorization: string | undefined, secrets: { catalog: string; ai: string }): Promise<void> {
  const configured = CALLERS.filter((caller) => secrets[caller].length >= 32);
  if (configured.length === 0) {
    throw new AccountsError("DEPENDENCY_UNAVAILABLE", "La credencial de servicio no está configurada");
  }
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (token.length < 20) {
    throw new AccountsError("SESSION_INVALID", "La credencial de servicio no es válida");
  }
  for (const caller of configured) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secrets[caller]), {
        algorithms: ["HS256"],
        issuer: caller,
        audience: "accounts.eligibility",
        subject: caller,
      });
      if (payload.sub === caller) {
        return;
      }
    } catch {
      continue;
    }
  }
  throw new AccountsError("SESSION_INVALID", "La credencial de servicio no es válida");
}
