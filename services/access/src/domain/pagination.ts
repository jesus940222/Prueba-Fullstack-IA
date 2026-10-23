import { AccessError } from "./access-error";

export interface PageQuery {
  page: number;
  pageSize: number;
  sort: "createdAt" | "-createdAt";
  includeDeleted: boolean;
  status?: "invited" | "active" | "disabled";
}

export function parseIncludeDeleted(value: unknown): boolean {
  if (value === undefined || value === "") {
    return false;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  throw new AccessError("VALIDATION_ERROR", "includeDeleted solo admite true o false", [
    { field: "includeDeleted", code: "invalid" },
  ]);
}

export function parsePageQuery(input: {
  page?: unknown;
  pageSize?: unknown;
  sort?: unknown;
  includeDeleted?: unknown;
  status?: unknown;
  pageDefault: number;
  pageMax: number;
}): PageQuery {
  const page = input.page === undefined || input.page === "" ? 1 : positiveInteger(input.page, "page");
  const requestedSize = input.pageSize === undefined || input.pageSize === "" ? input.pageDefault : positiveInteger(input.pageSize, "pageSize");
  if (requestedSize > input.pageMax) {
    throw new AccessError("VALIDATION_ERROR", "El tamaño de página supera el máximo", [{ field: "pageSize", code: "max" }]);
  }
  const sort = input.sort === undefined || input.sort === "" ? "-createdAt" : input.sort;
  if (sort !== "createdAt" && sort !== "-createdAt") {
    throw new AccessError("VALIDATION_ERROR", "El orden no está permitido", [{ field: "sort", code: "invalid" }]);
  }
  const status = input.status === undefined || input.status === "" ? undefined : input.status;
  if (status !== undefined && status !== "invited" && status !== "active" && status !== "disabled") {
    throw new AccessError("VALIDATION_ERROR", "El estado no está permitido", [{ field: "status", code: "invalid" }]);
  }
  return {
    page,
    pageSize: requestedSize,
    sort,
    includeDeleted: parseIncludeDeleted(input.includeDeleted),
    status,
  };
}

function positiveInteger(value: unknown, field: string): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    throw new AccessError("VALIDATION_ERROR", "La página no es válida", [{ field, code: "invalid" }]);
  }
  return Number(text);
}

export function pageWindow(page: number, pageSize: number): { offset: number; limit: number } {
  return { offset: (page - 1) * pageSize, limit: pageSize };
}

export function pageResult<T>(items: T[], totalItems: number, page: number, pageSize: number): {
  items: T[];
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
} {
  return {
    items,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
    page,
    pageSize,
  };
}
