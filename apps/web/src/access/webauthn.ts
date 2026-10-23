function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bufferOf(value: string): ArrayBuffer {
  const bytes = decodeBase64Url(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

interface Descriptor {
  id: string;
  type?: string;
  transports?: string[];
}

function publicKey(options: Record<string, unknown>, kind: "create" | "get"): Record<string, unknown> {
  const next: Record<string, unknown> = { ...options, challenge: bufferOf(String(options.challenge)) };
  const user = options.user as { id?: string } | undefined;
  if (user?.id) {
    next.user = { ...user, id: bufferOf(user.id) };
  }
  const credentialKey = kind === "create" ? "excludeCredentials" : "allowCredentials";
  const credentials = options[credentialKey] as Descriptor[] | undefined;
  if (credentials) {
    next[credentialKey] = credentials.map((item) => ({ ...item, id: bufferOf(item.id) }));
  }
  return next;
}

interface CeremonyCredential {
  id: string;
  rawId: ArrayBuffer;
  type: string;
  authenticatorAttachment?: string | null;
  getClientExtensionResults: () => Record<string, unknown>;
  response: {
    clientDataJSON: ArrayBuffer;
    attestationObject?: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
    getTransports?: () => string[];
  };
}

function credentialJson(credential: CeremonyCredential, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: extra,
  };
}

function ceremonyCredential(value: Credential | null): CeremonyCredential | null {
  if (!value || !("response" in value) || !value.response || typeof value.response !== "object") {
    return null;
  }
  return value as unknown as CeremonyCredential;
}

export async function createPasskey(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    throw new Error("authenticator_unavailable");
  }
  const credential = ceremonyCredential(await navigator.credentials.create({ publicKey: publicKey(options, "create") as unknown as PublicKeyCredentialCreationOptions }));
  if (!credential?.response.attestationObject) {
    throw new Error("authenticator_unavailable");
  }
  return credentialJson(credential, {
    clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
    attestationObject: encodeBase64Url(credential.response.attestationObject),
    transports: credential.response.getTransports?.() ?? [],
  });
}

export async function usePasskey(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error("authenticator_unavailable");
  }
  const credential = ceremonyCredential(await navigator.credentials.get({ publicKey: publicKey(options, "get") as unknown as PublicKeyCredentialRequestOptions }));
  if (!credential?.response.authenticatorData || !credential.response.signature) {
    throw new Error("authenticator_unavailable");
  }
  return credentialJson(credential, {
    clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
    authenticatorData: encodeBase64Url(credential.response.authenticatorData),
    signature: encodeBase64Url(credential.response.signature),
    userHandle: credential.response.userHandle ? encodeBase64Url(credential.response.userHandle) : null,
  });
}
