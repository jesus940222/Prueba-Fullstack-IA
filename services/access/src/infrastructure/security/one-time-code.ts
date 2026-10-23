import { createHmac, timingSafeEqual } from "node:crypto";
import type { OneTimeCode } from "../../application/ports";

export function createOneTimeCode(secret: string): OneTimeCode {
  return {
    protect(binding, code) {
      return createHmac("sha256", secret).update(`${binding}\0${code}`).digest("hex");
    },
    same(left, right) {
      const first = Buffer.from(left);
      const second = Buffer.from(right);
      return first.length === second.length && timingSafeEqual(first, second);
    },
  };
}
