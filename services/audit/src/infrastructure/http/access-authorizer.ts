import { SignJWT } from "jose";
import { principalFromAuthorize } from "../../application/access-decision";
import type { Authorizer } from "../../application/ports";
import { AuditError } from "../../domain/audit-error";

export function createAccessAuthorizer(baseUrl: string, secret: string): Authorizer {
  return {
    async authorize(sessionToken, permission, requireRecentVerification) {
      if (secret.length < 32) {
        throw new AuditError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión");
      }
      const serviceToken = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("audit")
        .setAudience("access.authorize")
        .setSubject("audit")
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
        throw new AuditError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión");
      }
      const body = response.status === 200 ? await response.json() as unknown : {};
      return principalFromAuthorize(response.status, body);
    },
  };
}
