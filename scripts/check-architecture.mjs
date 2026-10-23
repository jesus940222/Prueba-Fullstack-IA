import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXTERNAL_KEYS, PUBLIC_ENTRIES, SECRET_KEYS, SECRET_URL_KEYS, parseEnv } from "../infra/scripts/env-keys.mjs";

const FORBIDDEN = [
  "@nestjs",
  "typeorm",
  "mongoose",
  "ioredis",
  "amqplib",
  "express",
  "fastify",
  "redis",
  "@heroui",
  "react",
  "react-dom",
  "fastapi",
  "sqlalchemy",
  "langgraph",
  "qdrant_client",
  "openai",
  "pg",
];

const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
const PYTHON_PATTERN = /^\s*(?:from|import)\s+([a-zA-Z0-9_\.]+)/gm;

export function isForbiddenModule(specifier) {
  return FORBIDDEN.some((name) => specifier === name || specifier.startsWith(`${name}/`) || specifier.startsWith(`${name}.`));
}

export function findForbiddenImports(source) {
  const found = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    if (isForbiddenModule(match[1])) {
      found.push(match[1]);
    }
  }
  for (const match of source.matchAll(PYTHON_PATTERN)) {
    if (isForbiddenModule(match[1])) {
      found.push(match[1]);
    }
  }
  return found;
}

function walk(directory) {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (/\.(ts|tsx|py)$/.test(entry) && !entry.endsWith(".spec.ts")) {
      files.push(path);
    }
  }
  return files;
}

export function scan(root) {
  const errors = [];
  const domains = [
    ...["access", "accounts", "catalog", "audit"].map((service) => join(root, "services", service, "src", "domain")),
    join(root, "services", "ai", "portal_ai", "domain"),
  ];
  for (const directory of domains) {
    for (const file of walk(directory)) {
      const hits = findForbiddenImports(readFileSync(file, "utf8"));
      for (const hit of hits) {
        errors.push(`${relative(root, file)} importa ${hit}`);
      }
    }
  }
  const sourceFiles = walk(join(root, "services"));
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    if (/synchronize\s*:\s*true/.test(source) || /migrationsRun\s*:\s*true/.test(source)) {
      errors.push(`${relative(root, file)} activa synchronize o migrationsRun`);
    }
  }
  const example = parseEnv(readFileSync(join(root, ".env.example"), "utf8"));
  for (const key of [...SECRET_KEYS, ...EXTERNAL_KEYS, ...SECRET_URL_KEYS]) {
    if (!example.has(key) || example.get(key) !== "") {
      errors.push(`.env.example deja un valor en ${key}`);
    }
  }
  for (const [key, value] of PUBLIC_ENTRIES) {
    if (example.get(key) !== value) {
      errors.push(`.env.example no conserva ${key}`);
    }
  }
  const webRoot = join(root, "apps", "web");
  for (const file of walk(webRoot)) {
    const source = readFileSync(file, "utf8");
    if (/VITE_[A-Z0-9_]*(SECRET|PASSWORD|TOKEN|API_KEY)/.test(source)) {
      errors.push(`${relative(root, file)} expone un secreto VITE`);
    }
  }
  return errors;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const errors = scan(root);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("architecture_ok\n");
}
