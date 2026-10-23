import { accountStatusLabel, classifyConfirm, formatMexico, formatMxn, maskAccount } from "./money";

describe("account presentation", () => {
  it("formats decimal strings and refuses to call a timeout a success", () => {
    expect(formatMxn("24850.00")).toBe("$24,850.00 MXN");
    expect(formatMxn("10")).toBe("10");
    expect(classifyConfirm(200, { status: "completed", id: "00000000-0000-4000-8000-000000000001" })).toBe("completed");
    expect(classifyConfirm(0, null)).toBe("uncertain");
    expect(classifyConfirm(503, null)).toBe("uncertain");
    expect(classifyConfirm(504, { status: "completed", id: "x" })).toBe("uncertain");
    expect(classifyConfirm(422, { status: "completed" })).toBe("failed");
    expect(classifyConfirm(200, { status: "rejected" })).toBe("failed");
    expect(maskAccount("1000000000000001")).toBe("************0001");
    expect(maskAccount(undefined)).toBe("Número no incluido");
    expect(maskAccount("cuenta")).toBe("cuenta");
    expect(accountStatusLabel("active")).toBe("Activa");
    expect(accountStatusLabel("closed")).toBe("Cerrada");
    expect(accountStatusLabel("otro")).toBe("otro");
    expect(formatMexico("no-es-fecha")).toBe("no-es-fecha");
    expect(formatMexico("2026-01-15T16:00:00.000Z")).toContain("2026");
  });
});
