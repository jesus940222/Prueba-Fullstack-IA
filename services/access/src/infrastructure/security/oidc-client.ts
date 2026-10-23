import { createHash } from "node:crypto";
import type { OidcProvider } from "../../application/ports";

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedIssuers: string[];
}

const MICROSOFT_ISSUER = /^https:\/\/login\.microsoftonline\.com\/([A-Za-z0-9.-]+)\/v2\.0$/;
const IMPLICIT_TENANTS = new Set(["common", "organizations", "consumers"]);

function explicitTenant(issuer: string): string | null {
  const tenant = MICROSOFT_ISSUER.exec(issuer)?.[1] ?? "";
  if (tenant === "" || IMPLICIT_TENANTS.has(tenant.toLowerCase())) {
    return null;
  }
  return tenant;
}

function credentialsPresent(current: ProviderConfig): boolean {
  return current.clientId !== "" && current.clientSecret !== "" && current.redirectUri !== "";
}

export function createOidcClient(input: { google: ProviderConfig; microsoft: ProviderConfig }): OidcProvider {
  return {
    configured(provider) {
      const current = input[provider];
      if (!credentialsPresent(current)) {
        return false;
      }
      return provider === "google" || (current.allowedIssuers.length > 0 && current.allowedIssuers.every((issuer) => explicitTenant(issuer) !== null));
    },
    start(options) {
      const current = input[options.provider];
      const tenant = explicitTenant(current.allowedIssuers[0] ?? "");
      if (options.provider === "microsoft" && tenant === null) {
        throw new Error("microsoft_issuer_missing");
      }
      const authorization = options.provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
      const params = new URLSearchParams({
        client_id: current.clientId,
        redirect_uri: current.redirectUri,
        response_type: "code",
        scope: "openid email",
        state: options.state,
        nonce: options.nonce,
        code_challenge: createHash("sha256").update(options.verifier).digest("base64url"),
        code_challenge_method: "S256",
      });
      return `${authorization}?${params.toString()}`;
    },
    async exchange(options) {
      const current = input[options.provider];
      if (current.clientId === "" || current.clientSecret === "") {
        return "unavailable";
      }
      try {
        const configuredIssuer = current.allowedIssuers.find((issuer) => explicitTenant(issuer) !== null);
        const discoveryUrl = options.provider === "google"
          ? "https://accounts.google.com/.well-known/openid-configuration"
          : configuredIssuer ? `${configuredIssuer}/.well-known/openid-configuration` : "";
        if (discoveryUrl === "") {
          return "unavailable";
        }
        const metadata = await discover(discoveryUrl);
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code: options.code,
          redirect_uri: current.redirectUri,
          client_id: current.clientId,
          client_secret: current.clientSecret,
          code_verifier: options.verifier,
        });
        const tokenResponse = await fetch(metadata.token_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
        if (!tokenResponse.ok) {
          return "invalid";
        }
        const token = (await tokenResponse.json()) as { id_token?: string };
        if (!token.id_token) {
          return "invalid";
        }
        const { createRemoteJWKSet, decodeJwt, jwtVerify } = await import("jose");
        const decoded = decodeJwt(token.id_token);
        const issuer = String(decoded.iss ?? "");
        const allowed = options.provider === "google" ? ["https://accounts.google.com"] : current.allowedIssuers;
        if (!allowed.includes(issuer)) {
          return "invalid";
        }
        const keyMetadata = discoveryUrl.startsWith(issuer) ? metadata : await discover(`${issuer}/.well-known/openid-configuration`);
        const { payload } = await jwtVerify(token.id_token, createRemoteJWKSet(new URL(keyMetadata.jwks_uri)), {
          algorithms: ["RS256"],
          audience: current.clientId,
          issuer,
        });
        if (typeof payload.sub !== "string" || typeof payload.nonce !== "string") {
          return "invalid";
        }
        if (createHash("sha256").update(payload.nonce).digest("hex") !== options.nonce) {
          return "invalid";
        }
        return {
          issuer,
          subject: payload.sub,
          audience: current.clientId,
          nonce: payload.nonce,
          email: typeof payload.email === "string" ? payload.email : null,
        };
      } catch {
        return "unavailable";
      }
    },
  };
}

async function discover(url: string): Promise<{ token_endpoint: string; jwks_uri: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("oidc_discovery_failed");
  }
  return (await response.json()) as { token_endpoint: string; jwks_uri: string };
}
