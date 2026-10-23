import type { WebAuthnCeremony } from "../../application/ports";

export function createWebAuthn(input: { rpId: string; origin: string; rpName: string }): WebAuthnCeremony {
  const configured = input.rpId !== "" && input.origin !== "" && input.rpName !== "";
  return {
    configured: () => configured,
    async registrationOptions(options) {
      const { generateRegistrationOptions } = await import("@simplewebauthn/server");
      return generateRegistrationOptions({
        rpName: input.rpName,
        rpID: input.rpId,
        userID: new TextEncoder().encode(options.userId),
        userName: options.userName,
        challenge: options.challenge,
        attestationType: "none",
        excludeCredentials: options.excludeCredentialIds.map((id) => ({ id })),
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      }) as unknown as Record<string, unknown>;
    },
    async verifyRegistration(options) {
      const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
      try {
        const verified = await verifyRegistrationResponse({
          response: options.response as never,
          expectedChallenge: options.challenge,
          expectedOrigin: input.origin,
          expectedRPID: input.rpId,
          requireUserVerification: true,
        });
        if (!verified.verified || !verified.registrationInfo) {
          return null;
        }
        const credential = verified.registrationInfo.credential;
        const credentialId = typeof credential.id === "string" ? credential.id : Buffer.from(credential.id).toString("base64url");
        return {
          credentialId,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          signCount: credential.counter,
          transports: credential.transports ?? [],
          deviceType: verified.registrationInfo.credentialDeviceType ?? "singleDevice",
          backedUp: verified.registrationInfo.credentialBackedUp ?? false,
        };
      } catch {
        return null;
      }
    },
    async authenticationOptions(options) {
      const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
      return generateAuthenticationOptions({
        rpID: input.rpId,
        challenge: options.challenge,
        userVerification: "required",
        allowCredentials: options.credentialIds.map((id) => ({ id })),
      }) as unknown as Record<string, unknown>;
    },
    async verifyAuthentication(options) {
      const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
      try {
        const verified = await verifyAuthenticationResponse({
          response: options.response as never,
          expectedChallenge: options.challenge,
          expectedOrigin: input.origin,
          expectedRPID: input.rpId,
          requireUserVerification: true,
          credential: {
            id: options.credentialId,
            publicKey: Buffer.from(options.publicKey, "base64url"),
            counter: options.signCount,
            transports: options.transports as never,
          },
        });
        return verified.verified ? { signCount: verified.authenticationInfo.newCounter } : null;
      } catch {
        return null;
      }
    },
  };
}
