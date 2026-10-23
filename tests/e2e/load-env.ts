import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadBootstrapPassword(): void {
  if (process.env.E2E_BOOTSTRAP_PASSWORD?.trim()) {
    return;
  }
  const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of text.split(/\n/)) {
    if (!line.startsWith("ACCESS_BOOTSTRAP_PASSWORD=")) {
      continue;
    }
    const value = line.slice("ACCESS_BOOTSTRAP_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
    if (value !== "") {
      process.env.E2E_BOOTSTRAP_PASSWORD = value;
    }
  }
}
