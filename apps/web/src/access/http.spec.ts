import { QueryClient } from "@tanstack/react-query";
import { accessRequest, parseFlag, parsePositive, readApiMessage, readCsrf } from "./http";

describe("access http helpers", () => {
  it("reads the csrf cookie and drops idle cache on 401", async () => {
    expect(readCsrf("portal_csrf=abc%2B; other=1")).toBe("abc+");
    expect(readCsrf("theme=dark")).toBeUndefined();
    const client = new QueryClient();
    client.setQueryData(["profile"], { id: "1" });
    const fetchMock = jest.fn(async () => ({ status: 401, ok: false, json: async () => ({ code: "SESSION_INVALID" }) }));
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const response = await accessRequest(client, "/api/v1/access/me");
    globalThis.fetch = original;
    expect(response.status).toBe(401);
    expect(client.getQueryData(["profile"])).toBeUndefined();
  });

  it("parses page and includeDeleted without treating the word false as true", () => {
    expect(parsePositive(null, 1, 100)).toBe(1);
    expect(parsePositive("2", 1, 100)).toBe(2);
    expect(parsePositive("0", 1, 100)).toBeNull();
    expect(parsePositive("101", 1, 100)).toBeNull();
    expect(parseFlag(null)).toBe(false);
    expect(parseFlag("false")).toBe(false);
    expect(parseFlag("true")).toBe(true);
    expect(parseFlag("no")).toBeNull();
  });

  it("prefers the service message and falls back when the body is empty", async () => {
    await expect(readApiMessage({ json: async () => ({ message: " Rol de sistema " }) } as unknown as Response, "No se pudo")).resolves.toBe("Rol de sistema");
    await expect(readApiMessage({ json: async () => ({}) } as unknown as Response, "No se pudo")).resolves.toBe("No se pudo");
    await expect(readApiMessage({ json: async () => { throw new Error("empty"); } } as unknown as Response, "No se pudo")).resolves.toBe("No se pudo");
  });
});
