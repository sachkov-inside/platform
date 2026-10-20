import { once } from "node:events";
import { createServer, type Socket } from "node:net";

/** Owned SMTP peer. Acceptance is a real protocol reply after DATA, never a replacement sender. */
export async function startEmailSmtp() {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  let connections = 0;
  let overflow = false;
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("error", () => {
      socket.destroy();
    });
    socket.once("close", () => sockets.delete(socket));
    let data: string | undefined;
    let buffer = "";
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // The synthetic material is small. Bound both a single SMTP stream and retained DATA.
      if (
        Buffer.byteLength(buffer) + Buffer.byteLength(data ?? "") > 64 * 1024 ||
        messages.length >= 4
      ) {
        overflow = true;
        socket.destroy();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== undefined) {
          if (line === ".") {
            messages.push(data);
            data = undefined;
            socket.write("250 private-provider-reply-sentinel\r\n");
          } else data += `${line}\n`;
        } else if (/^(?:EHLO|HELO)/u.test(line))
          socket.write("250 localhost\r\n");
        else if (line === "DATA") {
          data = "";
          socket.write("354 go ahead\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
  };
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("SMTP loopback address missing");
    return {
      port: address.port,
      messages,
      get connections() {
        return connections;
      },
      get overflow() {
        return overflow;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
