import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { RandomSource } from "../../application/ports";

export function createRandomSource(): RandomSource {
  return {
    uuid: () => randomUUID(),
    token: (bytes) => randomBytes(bytes).toString("base64url"),
    digits: (length) => Array.from({ length }, () => String(randomInt(0, 10))).join(""),
  };
}
