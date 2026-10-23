import { UnavailableReadiness } from "../application/readiness";
import { AccessError } from "../domain/access-error";
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

  it("maps a domain access error with the correlation id already on the response", () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { status, getHeader: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    new SafeExceptionFilter().catch(new AccessError("PERMISSION_DENIED", "No tienes permiso"), { switchToHttp: () => ({ getResponse: () => response }) } as never);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "PERMISSION_DENIED", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
  });
});
