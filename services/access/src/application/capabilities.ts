export interface Capability {
  name: string;
  status: "configured" | "missing";
  verified: false;
}

export function presence(value: string | undefined): "configured" | "missing" {
  return value !== undefined && value.trim() !== "" ? "configured" : "missing";
}

export function allPresent(values: Array<string | undefined>): "configured" | "missing" {
  return values.every((value) => presence(value) === "configured") ? "configured" : "missing";
}

export function capability(name: string, status: "configured" | "missing"): Capability {
  return { name, status, verified: false };
}
