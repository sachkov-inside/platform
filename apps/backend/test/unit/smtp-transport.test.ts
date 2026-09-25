import { once } from "node:events";
import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, test } from "vitest";

import { assembleSmtpTransport } from "../../src/infrastructure/smtp/smtp-transport.js";

// A minimal plain SMTP responder on loopback: it accepts one message and keeps its raw data.
function smtpResponder(): { server: Server; messages: string[] } {
  const messages: string[] = [];
  const server = createServer((socket) => {
    let data: string | undefined;
    let buffer = "";
    socket.write("220 localhost ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== undefined) {
          if (line === ".") {
            messages.push(data);
            data = undefined;
            socket.write("250 queued\r\n");
          } else {
            data += `${line}\n`;
          }
        } else if (/^(?:EHLO|HELO)/u.test(line)) socket.write("250 localhost\r\n");
        else if (line === "DATA") {
          data = "";
          socket.write("354 go ahead\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  return { messages, server };
}

describe("SMTP transport", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
  });

  test("sends one message with a Message-ID in the sender's domain", async () => {
    const responder = smtpResponder();
    server = responder.server;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("SMTP responder has no port");
    const send = assembleSmtpTransport({
      from: "noreply@inside.example",
      localInsecure: true,
      smtpHost: "127.0.0.1",
      smtpPort: address.port,
    });

    await send({ messageRef: "operation-1", subject: "Subject", text: "Body", to: "member@example.com" });

    expect(responder.messages).toHaveLength(1);
    const message = responder.messages[0] ?? "";
    expect(message).toContain("Message-ID: <operation-1@inside.example>");
    expect(message).toContain("From: noreply@inside.example");
    expect(message).toContain("To: member@example.com");
    expect(message).toContain("Subject: Subject");
  });
});
