import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EVENT_TYPES } from "./events.ts";

function eventTypes(schema: { allOf?: Array<Record<string, unknown>> }): string[] {
  const found = new Set<string>();
  for (const branch of schema.allOf ?? []) {
    const condition = branch.if as { properties?: { event_type?: { const?: string; enum?: string[] } } } | undefined;
    const eventType = condition?.properties?.event_type;
    if (eventType?.const) {
      found.add(eventType.const);
    }
    for (const value of eventType?.enum ?? []) {
      found.add(value);
    }
  }
  return [...found].sort();
}

test("published event names match the versioned envelope", () => {
  const schema = JSON.parse(
    readFileSync(new URL("../../../docs/contratos/eventos/bus-envelope-1.schema.json", import.meta.url), "utf8"),
  ) as { allOf?: Array<Record<string, unknown>> };
  assert.deepEqual([...EVENT_TYPES].sort(), eventTypes(schema));
});
