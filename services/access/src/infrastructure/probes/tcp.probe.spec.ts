import { probeTcpEndpoint } from "./tcp.probe";

describe("probeTcpEndpoint", () => {
  it("does not open a socket when the URL is empty", async () => {
    const open = jest.fn();
    await expect(probeTcpEndpoint("", open)).resolves.toBe("not_configured");
    expect(open).not.toHaveBeenCalled();
  });

  it("uses the host and port from the URL", async () => {
    const open = jest.fn(async () => undefined);
    await expect(probeTcpEndpoint("smtp://mailpit:1025", open)).resolves.toBe("up");
    expect(open).toHaveBeenCalledWith("mailpit", 1025);
  });
});
