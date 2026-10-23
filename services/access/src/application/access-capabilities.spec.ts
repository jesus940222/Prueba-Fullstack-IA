import { buildAccessCapabilities } from "./access-capabilities";

describe("buildAccessCapabilities", () => {
  const secret = "super-secret-value";
  const input = {
    googleId: "",
    googleSecret: "",
    googleRedirect: "",
    microsoftId: "id",
    microsoftSecret: secret,
    microsoftRedirect: "http://localhost:8080/callback",
    microsoftIssuers: "",
    webauthnRpId: "localhost",
    webauthnOrigin: "http://localhost:8080",
    webauthnRpName: "Portal local",
    smtpUrl: "smtp://mailpit:1025",
    openAiKey: "",
    jwtSigningKey: secret,
  };

  it("keeps Microsoft unavailable while issuers are empty and does not echo secrets", () => {
    const report = buildAccessCapabilities(input);
    const microsoft = report.capabilities.find((item) => item.name === "microsoft_oidc");
    const openai = report.capabilities.find((item) => item.name === "openai");
    expect(microsoft?.status).toBe("missing");
    expect(openai?.status).toBe("missing");
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.capabilities.every((item) => item.verified === false)).toBe(true);
  });
});
