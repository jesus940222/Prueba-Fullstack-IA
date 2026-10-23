import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { DataSource } from "typeorm";
import type { AccessTokenIssuer } from "../../application/ports";

interface StoredKey {
  publicJwk: Record<string, unknown>;
  privatePem: string;
}

export class SigningKeys {
  constructor(
    private readonly dataSource: DataSource,
    private readonly secret: string,
    private readonly kid: string,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  async load(): Promise<StoredKey> {
    const rows = (await this.dataSource.query(`SELECT public_jwk, private_pkcs8 FROM signing_keys WHERE kid = $1`, [
      this.kid,
    ])) as Array<{ public_jwk: Record<string, unknown>; private_pkcs8: string }>;
    const existing = rows[0];
    if (existing) {
      return { publicJwk: existing.public_jwk, privatePem: open(this.secret, existing.private_pkcs8) };
    }
    const { generateKeyPair, exportJWK, exportPKCS8 } = await import("jose");
    const pair = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = await exportJWK(pair.publicKey);
    publicJwk.kid = this.kid;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    const privatePem = await exportPKCS8(pair.privateKey);
    await this.dataSource.query(
      `INSERT INTO signing_keys (kid, public_jwk, private_pkcs8, created_at) VALUES ($1, $2::jsonb, $3, now()) ON CONFLICT (kid) DO NOTHING`,
      [this.kid, JSON.stringify(publicJwk), seal(this.secret, privatePem)],
    );
    return this.load();
  }

  async jwks(): Promise<{ keys: Record<string, unknown>[] }> {
    const rows = (await this.dataSource.query(`SELECT public_jwk FROM signing_keys ORDER BY created_at`)) as Array<{
      public_jwk: Record<string, unknown>;
    }>;
    return { keys: rows.map((row) => row.public_jwk) };
  }

  async createIssuer(): Promise<AccessTokenIssuer> {
    const stored = await this.load();
    const { importPKCS8, importJWK, SignJWT, jwtVerify } = await import("jose");
    const privateKey = await importPKCS8(stored.privatePem, "RS256");
    const publicKey = await importJWK(stored.publicJwk, "RS256");
    const issuer = this.issuer;
    const audience = this.audience;
    return {
      async sign(input) {
        return new SignJWT({ sid: input.sessionId, ver: input.authorizationVersion, rst: input.restricted })
          .setProtectedHeader({ alg: "RS256", kid: stored.publicJwk.kid as string })
          .setSubject(input.userId)
          .setIssuer(issuer)
          .setAudience(audience)
          .setIssuedAt()
          .setExpirationTime(Math.floor(Date.parse(input.expiresAt) / 1000))
          .sign(privateKey);
      },
      async verify(token) {
        try {
          const { payload } = await jwtVerify(token, publicKey, {
            algorithms: ["RS256"],
            issuer,
            audience,
          });
          if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.ver !== "number") {
            return null;
          }
          return {
            userId: payload.sub,
            sessionId: payload.sid,
            authorizationVersion: payload.ver,
            restricted: payload.rst === true,
          };
        } catch {
          return null;
        }
      },
    };
  }
}

function keyMaterial(secret: string): Buffer {
  return scryptSync(secret, "portal-access-signing-key", 32);
}

function seal(secret: string, pem: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(secret), iv);
  const encrypted = Buffer.concat([cipher.update(pem, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function open(secret: string, packed: string): string {
  const [iv, tag, encrypted] = packed.split(".");
  if (!iv || !tag || !encrypted) {
    throw new Error("signing_key_unreadable");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
