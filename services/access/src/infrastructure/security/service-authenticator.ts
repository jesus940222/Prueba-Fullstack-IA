import type { ServiceAuthenticator } from "../../application/ports";

const SERVICES = ["accounts", "catalog", "audit", "ai"] as const;

export function createServiceAuthenticator(secrets: Record<(typeof SERVICES)[number], string>): ServiceAuthenticator {
  return {
    async verify(authorizationHeader, audience = "access.authorize") {
      const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : "";
      if (token.length < 20) {
        return null;
      }
      const { jwtVerify } = await import("jose");
      for (const service of SERVICES) {
        if (audience === "access.alert-recipients" && service !== "ai") {
          continue;
        }
        const secret = secrets[service];
        if (secret.length < 32) {
          continue;
        }
        try {
          const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
            algorithms: ["HS256"],
            issuer: service,
            audience,
            subject: service,
          });
          if (payload.sub === service) {
            return service;
          }
        } catch {
          continue;
        }
      }
      return null;
    },
  };
}
