import type { QueryClient } from "@tanstack/react-query";

export function readCsrf(cookie = document.cookie): string | undefined {
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "portal_csrf") {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

export async function accessRequest(client: QueryClient, path: string, init: RequestInit = {}): Promise<Response> {
  const csrf = readCsrf();
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (csrf) {
    headers.set("x-csrf-token", csrf);
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (response.status === 401) {
    for (const query of client.getQueryCache().getAll()) {
      if (query.state.fetchStatus === "fetching") {
        continue;
      }
      client.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
  return response;
}

export function parsePositive(value: string | null, fallback: number, max: number): number | null {
  if (value === null || value === "") {
    return fallback;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return parsed > max ? null : parsed;
}

export async function readApiMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim().length > 0) {
      return body.message.trim();
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function parseFlag(value: string | null): boolean | null {
  if (value === null || value === "" || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  return null;
}
