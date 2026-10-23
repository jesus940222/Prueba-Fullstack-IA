import { writeFileSync } from "node:fs";
import { exampleText } from "./env-keys.mjs";

writeFileSync(new URL("../../.env.example", import.meta.url), exampleText(), { encoding: "utf8" });
process.stdout.write("example_written\n");
