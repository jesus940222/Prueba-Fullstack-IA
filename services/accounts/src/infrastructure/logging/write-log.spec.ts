import { toLogRecord, writeLog } from "./write-log";

describe("toLogRecord", () => {
  it("keeps the operational fields and drops anything else", () => {
    const input = {
      level: "error" as const,
      event: "dependency_check",
      dependency: "postgres",
      errorCode: "dependency_unreachable",
      password: "secret",
      databaseUrl: "postgresql://access:secret@postgres/access",
    };
    const record = toLogRecord(input, "access", "0.2.0");
    expect(record.service).toBe("access");
    expect(record.errorCode).toBe("dependency_unreachable");
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(record).not.toHaveProperty("password");
  });

  it("writes a single JSON line", () => {
    const spy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    writeLog({ level: "info", event: "listening" });
    expect(String(spy.mock.calls[0][0])).toContain("\"event\":\"listening\"");
    spy.mockRestore();
  });
});
