import assert from "node:assert/strict";
import { test } from "node:test";
import { findForbiddenImports, isForbiddenModule } from "./check-architecture.mjs";

test("flags a framework import inside domain source", () => {
  const hits = findForbiddenImports('import { Module } from "@nestjs/common";\n');
  assert.deepEqual(hits, ["@nestjs/common"]);
});

test("allows a relative domain import", () => {
  assert.deepEqual(findForbiddenImports('import { resolveCorrelationId } from "./correlation";\n'), []);
});

test("flags a python framework import", () => {
  assert.deepEqual(findForbiddenImports("from sqlalchemy import text\n"), ["sqlalchemy"]);
});

test("matches package boundaries", () => {
  assert.equal(isForbiddenModule("react"), true);
  assert.equal(isForbiddenModule("react-hook-form"), false);
});
