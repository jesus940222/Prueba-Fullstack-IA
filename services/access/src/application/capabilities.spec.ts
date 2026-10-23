import { allPresent, capability, presence } from "./capabilities";

describe("capability presence", () => {
  it("treats blank credentials as missing", () => {
    expect(presence(undefined)).toBe("missing");
    expect(presence("  ")).toBe("missing");
    expect(presence("present")).toBe("configured");
  });

  it("requires every field, including Microsoft issuers", () => {
    expect(allPresent(["id", "secret", "redirect", ""])).toBe("missing");
    expect(allPresent(["id", "secret", "redirect", "https://login.microsoftonline.com/tenant/v2.0"])).toBe(
      "configured",
    );
  });

  it("never marks a configured credential as verified", () => {
    const report = capability("openai", "configured");
    expect(report.verified).toBe(false);
    expect(JSON.stringify(report)).not.toContain("sk-");
  });
});
