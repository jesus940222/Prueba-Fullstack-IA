import { createOidcClient } from "./oidc-client";

const redirect = "http://localhost:8080/api/v1/access/auth/oidc/microsoft/callback";
const tenant = "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0";

function client(issuers: string[]) {
  return createOidcClient({
    google: { clientId: "google-client", clientSecret: "google-secret", redirectUri: "http://localhost:8080/callback", allowedIssuers: ["https://accounts.google.com"] },
    microsoft: { clientId: "ms-client", clientSecret: "ms-secret", redirectUri: redirect, allowedIssuers: issuers },
  });
}

describe("oidc client", () => {
  it("does not treat an empty Microsoft issuer list as the common tenant", () => {
    const oidc = client([]);
    expect(oidc.configured("microsoft")).toBe(false);
    expect(() => oidc.start({ provider: "microsoft", state: "state", nonce: "nonce", verifier: "verifier", returnTo: "/" })).toThrow("microsoft_issuer_missing");
  });

  it("rejects the implicit common, organizations and consumers tenants", () => {
    for (const tenantName of ["common", "organizations", "consumers"]) {
      const oidc = client([`https://login.microsoftonline.com/${tenantName}/v2.0`]);
      expect(oidc.configured("microsoft")).toBe(false);
    }
  });

  it("starts Microsoft against the configured tenant", () => {
    const oidc = client([tenant]);
    expect(oidc.configured("microsoft")).toBe(true);
    const url = new URL(oidc.start({ provider: "microsoft", state: "state", nonce: "nonce", verifier: "verifier", returnTo: "/" }));
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/11111111-1111-1111-1111-111111111111/oauth2/v2.0/authorize");
    expect(url.pathname).not.toContain("/common/");
    expect(url.searchParams.get("client_id")).toBe("ms-client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("keeps Google on its own authorization endpoint", () => {
    const oidc = client([]);
    expect(oidc.configured("google")).toBe(true);
    const url = new URL(oidc.start({ provider: "google", state: "state", nonce: "nonce", verifier: "verifier", returnTo: "/" }));
    expect(url.origin).toBe("https://accounts.google.com");
  });
});
