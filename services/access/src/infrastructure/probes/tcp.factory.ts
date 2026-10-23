import net from "node:net";

export function openTcp(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: 1000 });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("connect", () => {
      socket.end();
      resolve();
    });
    socket.once("timeout", () => fail(new Error("timeout")));
    socket.once("error", fail);
  });
}
