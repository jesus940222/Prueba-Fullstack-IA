import { SignJWT } from "jose";
import { principalFromAuthorize } from "../../application/access-decision";
import type { Authorizer } from "../../application/ports";
import { AccountsError } from "../../domain/accounts-error";

export function createAccessAuthorizer(baseUrl: string, secret: string): Authorizer {
  return {
    async authorize(sessionToken, permission, requireRecentVerification) {
      if (secret.length < 32) {
        throw new AccountsError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión");
      }
      const serviceToken = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("accounts")
        .setAudience("access.authorize")
        .setSubject("accounts")
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(new TextEncoder().encode(secret));
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/$/, "")}/internal/v1/access/authorize`, {
          method: "POST",
          headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
          body: JSON.stringify({ sessionToken, applicationCode: "portal", permission, requireRecentVerification }),
        });
      } catch {
        throw new AccountsError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión");
      }
      const body = response.status === 200 ? await response.json() as unknown : {};
      return principalFromAuthorize(response.status, body);
    },
  };
}
