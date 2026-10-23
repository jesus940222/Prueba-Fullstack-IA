import { buildAccessCapabilities } from "../../application/access-capabilities";
import type { AppEnv } from "../config/env";

export function buildCapabilities(env: AppEnv) {
  const data = env.credentials;
  return buildAccessCapabilities({
    googleId: data.GOOGLE_CLIENT_ID,
    googleSecret: data.GOOGLE_CLIENT_SECRET,
    googleRedirect: data.GOOGLE_REDIRECT_URI,
    microsoftId: data.MICROSOFT_CLIENT_ID,
    microsoftSecret: data.MICROSOFT_CLIENT_SECRET,
    microsoftRedirect: data.MICROSOFT_REDIRECT_URI,
    microsoftIssuers: data.MICROSOFT_ALLOWED_ISSUERS,
    webauthnRpId: data.WEBAUTHN_RP_ID,
    webauthnOrigin: data.WEBAUTHN_ORIGIN,
    webauthnRpName: data.WEBAUTHN_RP_NAME,
    smtpUrl: data.SMTP_URL,
    openAiKey: data.OPENAI_API_KEY,
    jwtSigningKey: data.JWT_SIGNING_KEY,
  });
}
