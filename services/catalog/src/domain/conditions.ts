import { CatalogError } from "./catalog-error";
import type { ConditionsRecord } from "./records";

const MONEY = /^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const LABEL = /^[\p{L}\p{N} .,%+-]{1,80}$/u;

type FieldKind = "money" | "label" | "months" | "boolean";

const SCHEMAS: Record<string, Record<string, FieldKind>> = {
  inversion: { termMonths: "months", minimumAmount: "money", rateLabel: "label" },
  prestamo: { termMonths: "months", illustrativeRate: "label", requiresReview: "boolean" },
  seguro: { termMonths: "months", coverageLabel: "label" },
};

export function assertConditions(categoryCode: string, conditions: ConditionsRecord): ConditionsRecord {
  if (!Number.isInteger(conditions.schemaVersion) || conditions.schemaVersion !== 1) {
    throw new CatalogError("VALIDATION_ERROR", "La versión de condiciones no está permitida", [{ field: "conditions.schemaVersion", code: "invalid" }]);
  }
  const schema = SCHEMAS[categoryCode];
  const attributes = conditions.attributes;
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    throw new CatalogError("VALIDATION_ERROR", "Las condiciones no son válidas", [{ field: "conditions.attributes", code: "invalid" }]);
  }
  const allowed = schema ? Object.keys(schema) : [];
  const present = Object.keys(attributes);
  if (present.length > 30) {
    throw new CatalogError("VALIDATION_ERROR", "Las condiciones exceden el máximo", [{ field: "conditions.attributes", code: "max" }]);
  }
  for (const key of present) {
    if (!allowed.includes(key)) {
      throw new CatalogError("VALIDATION_ERROR", "La condición no pertenece al esquema de la categoría", [{ field: `conditions.attributes.${key}`, code: "unknown" }]);
    }
  }
  if (schema) {
    for (const key of allowed) {
      if (!(key in attributes)) {
        throw new CatalogError("VALIDATION_ERROR", "Falta una condición del esquema", [{ field: `conditions.attributes.${key}`, code: "required" }]);
      }
      assertValue(key, schema[key] ?? "label", attributes[key]);
    }
  }
  return { schemaVersion: 1, attributes: { ...attributes } };
}

function assertValue(key: string, kind: FieldKind, value: unknown): void {
  const field = `conditions.attributes.${key}`;
  if (kind === "boolean") {
    if (typeof value !== "boolean") {
      throw new CatalogError("VALIDATION_ERROR", "La condición no es válida", [{ field, code: "invalid" }]);
    }
    return;
  }
  if (kind === "months") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 600) {
      throw new CatalogError("VALIDATION_ERROR", "El plazo no es válido", [{ field, code: "invalid" }]);
    }
    return;
  }
  if (typeof value !== "string" || (kind === "money" ? !MONEY.test(value) : !LABEL.test(value))) {
    throw new CatalogError("VALIDATION_ERROR", "La condición no es válida", [{ field, code: "invalid" }]);
  }
}
