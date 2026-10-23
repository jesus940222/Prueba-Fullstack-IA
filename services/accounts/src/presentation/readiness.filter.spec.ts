import { UnavailableReadiness } from "../application/readiness";
import { SafeExceptionFilter } from "./readiness.filter";

describe("SafeExceptionFilter", () => {
  function host() {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    return {
      json,
      status,
      arguments: { switchToHttp: () => ({ getResponse: () => ({ status }) }) },
    };
  }

  it("returns the readiness report when a required dependency is down", () => {
    const report = { status: "unavailable" as const, service: "access", checks: [] };
    const current = host();
    new SafeExceptionFilter().catch(new UnavailableReadiness(report), current.arguments as never);
    expect(current.status).toHaveBeenCalledWith(503);
    expect(current.json).toHaveBeenCalledWith(report);
  });

  it("hides unexpected failure details", () => {
    const current = host();
    new SafeExceptionFilter().catch(new Error("password=secret"), current.arguments as never);
    expect(current.status).toHaveBeenCalledWith(500);
    expect(current.json).toHaveBeenCalledWith({ code: "UNEXPECTED_FAILURE" });
  });
});
