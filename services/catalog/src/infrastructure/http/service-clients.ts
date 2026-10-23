import { SignJWT } from "jose";
import { principalFromAuthorize } from "../../application/access-decision";
import type { AccountsContext, Authorizer } from "../../application/ports";
import { CatalogError } from "../../domain/catalog-error";
import type { FinancialContext } from "../../domain/eligibility";

export function createAccessAuthorizer(baseUrl: string, secret: string): Authorizer {
  return {
    async authorize(sessionToken, permission, requireRecentVerification) {
      if (secret.length < 32) {
        throw new CatalogError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión");
      }
      const serviceToken = await serviceJwt(secret, "catalog", "access.authorize");
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/$/, "")}/internal/v1/access/authorize`, {
          method: "POST",
          headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
          body: JSON.stringify({ sessionToken, applicationCode: "portal", permission, requireRecentVerification }),
        });
      } catch {
        throw new CatalogError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar la sesión");
      }
      const body = response.status === 200 ? await response.json() as unknown : {};
      return principalFromAuthorize(response.status, body);
    },
  };
}

export function createAccountsContext(baseUrl: string, secret: string): AccountsContext {
  return {
    async customerIdForUser(userId) {
      const body = await post(baseUrl, secret, "/internal/v1/accounts/customer-link", { userId });
      const record = body as { customerId?: unknown };
      return typeof record.customerId === "string" ? record.customerId : null;
    },
    async eligibility(customerId, fields) {
      const body = await post(baseUrl, secret, "/internal/v1/accounts/eligibility-context", { customerId, fields });
      const record = body as { verifiable?: unknown; attributes?: { totalBalance?: unknown; accountAgeDays?: unknown } };
      if (record.verifiable !== true) {
        return { verifiable: false };
      }
      const context: FinancialContext = { verifiable: true };
      if (typeof record.attributes?.totalBalance === "string") {
        context.totalBalance = record.attributes.totalBalance;
      }
      if (typeof record.attributes?.accountAgeDays === "number") {
        context.accountAgeDays = record.attributes.accountAgeDays;
      }
      return context;
    },
  };
}

async function post(baseUrl: string, secret: string, path: string, body: unknown): Promise<unknown> {
  if (secret.length < 32) {
    throw new CatalogError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar el contexto de Cuentas");
  }
  const serviceToken = await serviceJwt(secret, "catalog", "accounts.eligibility");
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CatalogError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar el contexto de Cuentas");
  }
  if (response.status !== 200) {
    throw new CatalogError("DEPENDENCY_UNAVAILABLE", "No se pudo comprobar el contexto de Cuentas");
  }
  return response.json() as Promise<unknown>;
}

function serviceJwt(secret: string, issuer: string, audience: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(issuer)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(new TextEncoder().encode(secret));
}
