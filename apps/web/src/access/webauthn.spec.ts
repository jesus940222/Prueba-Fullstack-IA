import { createPasskey, usePasskey } from "./webauthn";

function credential(response: Record<string, unknown>) {
  return {
    id: "cred",
    rawId: Uint8Array.from([1, 2, 3]).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({}),
    response,
  };
}

describe("webauthn client", () => {
  const originalCredential = window.PublicKeyCredential;
  const originalCredentials = navigator.credentials;

  afterEach(() => {
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: originalCredential });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: originalCredentials });
  });

  it("reports when the browser has no authenticator", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
    await expect(createPasskey({ challenge: "AQID" })).rejects.toThrow("authenticator_unavailable");
    await expect(usePasskey({ challenge: "AQID" })).rejects.toThrow("authenticator_unavailable");
  });

  it("turns registration and authentication options into JSON proofs", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: function PublicKeyCredential() { return undefined; } });
    let seenChallenge: ArrayBuffer | undefined;
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        async create(options: CredentialCreationOptions) {
          seenChallenge = options.publicKey?.challenge as ArrayBuffer;
          return credential({
            clientDataJSON: Uint8Array.from([4]).buffer,
            attestationObject: Uint8Array.from([5]).buffer,
            getTransports: () => ["internal"],
          });
        },
        async get() {
          return credential({
            clientDataJSON: Uint8Array.from([6]).buffer,
            authenticatorData: Uint8Array.from([7]).buffer,
            signature: Uint8Array.from([8]).buffer,
            userHandle: Uint8Array.from([9]).buffer,
          });
        },
      },
    });
    const registered = await createPasskey({
      challenge: "AQID",
      user: { id: "AQID", name: "ana@portal.local", displayName: "Ana" },
      excludeCredentials: [{ id: "AQID", type: "public-key", transports: ["internal"] }],
    });
    expect(new Uint8Array(seenChallenge ?? new ArrayBuffer(0))).toEqual(Uint8Array.from([1, 2, 3]));
    expect(registered).toMatchObject({ id: "cred", type: "public-key", response: { transports: ["internal"] } });
    const used = await usePasskey({
      challenge: "AQID",
      allowCredentials: [{ id: "AQID", type: "public-key" }],
    });
    expect(used.response).toMatchObject({ userHandle: expect.any(String) });
  });

  it("rejects a credential that is not a passkey proof", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: function PublicKeyCredential() { return undefined; } });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        async create() { return null; },
        async get() { return { id: "x", rawId: new ArrayBuffer(0), type: "public-key", response: {} }; },
      },
    });
    await expect(createPasskey({ challenge: "AQID" })).rejects.toThrow("authenticator_unavailable");
    await expect(usePasskey({ challenge: "AQID" })).rejects.toThrow("authenticator_unavailable");
  });
});
