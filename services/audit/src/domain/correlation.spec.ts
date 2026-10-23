import { resolveCorrelationId } from "./correlation";

describe("resolveCorrelationId", () => {
  const generated = "11111111-1111-4111-8111-111111111111";
  const next = () => generated;

  it("keeps a version-4 UUID and normalizes its case", () => {
    expect(resolveCorrelationId("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", next)).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("replaces a missing, blank or non-v4 value", () => {
    expect(resolveCorrelationId(undefined, next)).toBe(generated);
    expect(resolveCorrelationId("   ", next)).toBe(generated);
    expect(resolveCorrelationId("not-a-uuid", next)).toBe(generated);
    expect(resolveCorrelationId("aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa", next)).toBe(generated);
  });
});
