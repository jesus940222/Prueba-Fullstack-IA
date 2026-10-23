import { TextDecoder, TextEncoder } from "node:util";

Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: TextDecoder });

if (typeof Element !== "undefined" && typeof Element.prototype.getAnimations !== "function") {
  Element.prototype.getAnimations = () => [];
}

if (typeof globalThis.fetch !== "function") {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async () => {
      throw new Error("fetch_not_stubbed");
    },
  });
}
