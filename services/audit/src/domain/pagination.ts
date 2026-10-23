import { AuditError } from "./audit-error";

export interface PageQuery {
  page: number;
  pageSize: number;
  sort: "createdAt" | "-createdAt";
}

export function parsePageQuery(input: {
  page?: unknown;
  pageSize?: unknown;
  sort?: unknown;
  pageDefault: number;
  pageMax: number;
}): PageQuery {
  const page = input.page === undefined || input.page === "" ? 1 : positive(input.page, "page");
  const requested = input.pageSize === undefined || input.pageSize === "" ? input.pageDefault : positive(input.pageSize, "pageSize");
  if (requested > input.pageMax) {
    throw new AuditError("VALIDATION_ERROR", "El tamaño de página supera el máximo", [{ field: "pageSize", code: "max" }]);
  }
  const sort = input.sort === undefined || input.sort === "" ? "-createdAt" : input.sort;
  if (sort !== "createdAt" && sort !== "-createdAt") {
    throw new AuditError("VALIDATION_ERROR", "El orden no está permitido", [{ field: "sort", code: "invalid" }]);
  }
  return { page, pageSize: requested, sort };
}

export function pageResult<T>(items: T[], totalItems: number, query: PageQuery) {
  return {
    items,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
  };
}

function positive(value: unknown, field: string): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    throw new AuditError("VALIDATION_ERROR", "La página no es válida", [{ field, code: "invalid" }]);
  }
  return Number(text);
}
