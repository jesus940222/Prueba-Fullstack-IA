import { AccountsError, httpStatusFor } from "./accounts-error";
import { decodeCursor, encodeCursor, escapeLike, pageByCursor } from "./cursor";
import { pageResult, parsePageQuery } from "./pagination";

describe("pages and cursors", () => {
  it("returns an empty page past the end and rejects an unknown sort", () => {
    const query = parsePageQuery({ page: "3", pageSize: "20", pageDefault: 20, pageMax: 100 });
    expect(pageResult([], 2, query)).toMatchObject({ items: [], totalItems: 2, totalPages: 1, page: 3 });
    expect(thrown(() => parsePageQuery({ sort: "balance", pageDefault: 20, pageMax: 100 })).code).toBe("VALIDATION_ERROR");
    expect(httpStatusFor("SESSION_INVALID")).toBe(401);
    expect(httpStatusFor("CSRF_INVALID")).toBe(403);
    expect(httpStatusFor("PERMISSION_DENIED")).toBe(403);
    expect(httpStatusFor("RESOURCE_NOT_VISIBLE")).toBe(404);
    expect(httpStatusFor("CONFLICT")).toBe(409);
    expect(httpStatusFor("IDEMPOTENCY_CONFLICT")).toBe(409);
    expect(httpStatusFor("RATE_LIMITED")).toBe(429);
    expect(httpStatusFor("DEPENDENCY_UNAVAILABLE")).toBe(503);
    expect(httpStatusFor("VALIDATION_ERROR")).toBe(422);
    expect(httpStatusFor("BUSINESS_RULE")).toBe(422);
    expect(httpStatusFor("RECENT_VERIFICATION_REQUIRED")).toBe(422);
  });

  it("binds the cursor to the active search", () => {
    const cursor = encodeCursor({ search: "bru", alias: "Bruno", id: "00000000-0000-4000-8000-0000000000aa" });
    expect(decodeCursor(cursor, "bru").alias).toBe("Bruno");
    expect(thrown(() => decodeCursor(cursor, "eli")).code).toBe("VALIDATION_ERROR");
    expect(thrown(() => decodeCursor("%%%", "")).code).toBe("VALIDATION_ERROR");
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
    expect(() => pageByCursor([{ alias: "Bruno", id: "00000000-0000-4000-8000-0000000000b1" }], "", { search: "", alias: "Missing", id: "00000000-0000-4000-8000-0000000000b9" }, 1)).toThrow(AccountsError);
    const page = pageByCursor(
      [{ alias: "Elena", id: "00000000-0000-4000-8000-0000000000b2" }, { alias: "Bruno", id: "00000000-0000-4000-8000-0000000000b1" }],
      "",
      null,
      1,
    );
    expect(page.items.map((item) => item.alias)).toEqual(["Bruno"]);
    expect(page.hasMore).toBe(true);
    const next = pageByCursor(
      [{ alias: "Elena", id: "00000000-0000-4000-8000-0000000000b2" }, { alias: "Bruno", id: "00000000-0000-4000-8000-0000000000b1" }],
      "",
      decodeCursor(page.nextCursor ?? "", ""),
      1,
    );
    expect(next.items.map((item) => item.alias)).toEqual(["Elena"]);
    expect(next.hasMore).toBe(false);
  });
});

function thrown(run: () => void): AccountsError {
  try {
    run();
  } catch (error) {
    if (error instanceof AccountsError) {
      return error;
    }
  }
  throw new Error("expected_accounts_error");
}
