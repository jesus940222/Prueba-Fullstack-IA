import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import type { PasswordHasher } from "../../application/ports";

export function createPasswordHasher(): PasswordHasher {
  return {
    async hash(password) {
      return argon2id({
        password,
        salt: randomBytes(16),
        parallelism: 1,
        iterations: 2,
        memorySize: 19456,
        hashLength: 32,
        outputType: "encoded",
      });
    },
    async verify(password, passwordHash) {
      return argon2Verify({ password, hash: passwordHash });
    },
  };
}
