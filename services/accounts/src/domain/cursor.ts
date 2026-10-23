import { AccountsError } from "./accounts-error";

export interface BeneficiaryCursor {
  search: string;
  alias: string;
  id: string;
}

export function encodeCursor(cursor: BeneficiaryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function pageByCursor<T extends { alias: string; id: string }>(
  items: readonly T[],
  search: string,
  cursor: BeneficiaryCursor | null,
  limit: number,
): { items: T[]; nextCursor: string | null; hasMore: boolean } {
  const filtered = items
    .filter((item) => search === "" || item.alias.toLocaleLowerCase("es-MX").includes(search.toLocaleLowerCase("es-MX")))
    .slice()
    .sort((left, right) => left.alias.localeCompare(right.alias, "es-MX") || left.id.localeCompare(right.id));
  let start = 0;
  if (cursor) {
    const index = filtered.findIndex((item) => item.alias === cursor.alias && item.id === cursor.id);
    if (index < 0) {
      throw new AccountsError("VALIDATION_ERROR", "El cursor no corresponde a esta búsqueda", [{ field: "cursor", code: "invalid" }]);
    }
    start = index + 1;
  }
  const window = filtered.slice(start, start + limit + 1);
  const page = window.slice(0, limit);
  const last = page[page.length - 1];
  const hasMore = window.length > limit;
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ search, alias: last.alias, id: last.id }) : null,
  };
}

export function decodeCursor(value: string, search: string): BeneficiaryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<BeneficiaryCursor>;
    if (typeof parsed.alias !== "string" || typeof parsed.id !== "string" || parsed.search !== search) {
      throw new Error("invalid");
    }
    if (!/^[0-9a-f-]{36}$/i.test(parsed.id)) {
      throw new Error("invalid");
    }
    return { search, alias: parsed.alias, id: parsed.id };
  } catch {
    throw new AccountsError("VALIDATION_ERROR", "El cursor no corresponde a esta búsqueda", [{ field: "cursor", code: "invalid" }]);
  }
}
