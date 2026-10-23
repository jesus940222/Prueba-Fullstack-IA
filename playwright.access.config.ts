import { defineConfig } from "@playwright/test";
import { loadBootstrapPassword } from "./tests/e2e/load-env";

loadBootstrapPassword();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /access-login\.spec\.ts/,
  use: { baseURL: "http://127.0.0.1:8080" },
  timeout: 60000,
});
