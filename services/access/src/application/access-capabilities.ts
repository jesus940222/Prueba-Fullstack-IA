import { allPresent, capability, presence, type Capability } from "./capabilities";

export interface AccessCapabilityInput {
  googleId: string;
  googleSecret: string;
  googleRedirect: string;
  microsoftId: string;
  microsoftSecret: string;
  microsoftRedirect: string;
  microsoftIssuers: string;
  webauthnRpId: string;
  webauthnOrigin: string;
  webauthnRpName: string;
  smtpUrl: string;
  openAiKey: string;
  jwtSigningKey: string;
}

export function buildAccessCapabilities(input: AccessCapabilityInput): { capabilities: Capability[] } {
  return {
    capabilities: [
      capability("google_oidc", allPresent([input.googleId, input.googleSecret, input.googleRedirect])),
      capability(
        "microsoft_oidc",
        allPresent([input.microsoftId, input.microsoftSecret, input.microsoftRedirect, input.microsoftIssuers]),
      ),
      capability("webauthn", allPresent([input.webauthnRpId, input.webauthnOrigin, input.webauthnRpName])),
      capability("smtp", presence(input.smtpUrl)),
      capability("jwt_signing", presence(input.jwtSigningKey)),
      capability("openai", presence(input.openAiKey)),
    ],
  };
}
