import { once } from "node:events";
// deterministic-test-allow unit-io: this named owned loopback HTTP contract verifies incomplete request shutdown.
import { createServer } from "node:http";
// deterministic-test-allow unit-io: this case owns and closes the TCP client of its loopback HTTP server.
import { createConnection } from "node:net";

import { expect, it, onTestFinished } from "vitest";

import { closeReviewServer } from "../../scripts/trainer-widget/review-lifecycle.js";

it("closes the owned review HTTP boundary even when a POST body never finishes", async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const server = createServer((request, response) => {
    markStarted();
    request.on("error", () => response.destroy());
    request.resume();
  });
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No loopback port");
  const socket = createConnection(address.port, "127.0.0.1");
  onTestFinished(() => {
    socket.destroy();
  });
  await once(socket, "connect");
  const socketClosed = once(socket, "close");
  socket.write(
    `POST /api/reset HTTP/1.1\r\nHost: 127.0.0.1:${String(address.port)}\r\nContent-Type: application/json\r\nContent-Length: 1\r\n\r\n`,
  );
  await started;

  await closeReviewServer(server);
  await socketClosed;
  expect(server.listening).toBe(false);
}, 1000);
