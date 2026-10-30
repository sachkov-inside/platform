import { createServer } from "node:http";
import { request } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";
import { fullStackSessionState } from "../support/full-stack-session";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

it("reports a socket abort without exposing Playwright's cookie call log", async () => {
  let requests = 0;
  const server = createServer((incoming) => {
    requests++;
    incoming.socket.destroy();
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing loopback address");
  vi.stubEnv(
    "FULLSTACK_WEB_BASE_URL",
    `http://127.0.0.1:${String(address.port)}`,
  );
  const client = await request.newContext({
    extraHTTPHeaders: { cookie: "session=synthetic-private-value" },
  });
  cleanup.push(() => client.dispose());
  const failure = await fullStackSessionState({ request: client }).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain("phase=request");
  expect(String(failure)).toContain("code=ECONNRESET");
  expect(String(failure)).not.toContain("synthetic-private-value");
  expect(String(failure)).not.toContain("Call log");
  expect(requests).toBe(1);
});

it("keeps HTTP, JSON, schema, guest and dependency outcomes distinct on real HTTP", async () => {
  const replies = [
    { status: 503, body: '{"state":"authenticated"}', expected: "HTTP 503" },
    {
      status: 200,
      body: "private non-JSON response",
      expected: "invalid JSON",
    },
    {
      status: 200,
      body: '{"state":"private unexpected state"}',
      expected: "invalid state",
    },
    { status: 200, body: "{}", expected: "invalid state" },
    { status: 200, body: '{"state":"guest"}', expected: "guest" },
    { status: 200, body: '{"state":"unavailable"}', expected: "unavailable" },
    {
      status: 200,
      body: '{"state":"authenticated"}',
      expected: "authenticated",
    },
  ];
  let index = 0;
  const server = createServer((_incoming, response) => {
    const reply = replies[index++];
    if (reply === undefined) throw new Error("Unexpected additional request");
    response.writeHead(reply.status, { "content-type": "application/json" });
    response.end(reply.body);
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing loopback address");
  vi.stubEnv(
    "FULLSTACK_WEB_BASE_URL",
    `http://127.0.0.1:${String(address.port)}`,
  );
  const client = await request.newContext();
  cleanup.push(() => client.dispose());
  for (const reply of replies) {
    expect(await fullStackSessionState({ request: client })).toBe(
      reply.expected,
    );
  }
  expect(index).toBe(replies.length);
});

it("does not accept an authenticated prefix when the response body is aborted", async () => {
  const server = createServer((_incoming, response) => {
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "1000",
    });
    response.write('{"state":"authenticated"}', () => response.destroy());
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing loopback address");
  vi.stubEnv(
    "FULLSTACK_WEB_BASE_URL",
    `http://127.0.0.1:${String(address.port)}`,
  );
  const client = await request.newContext();
  cleanup.push(() => client.dispose());
  await expect(fullStackSessionState({ request: client })).rejects.toThrow(
    "Session state is unknown",
  );
});

it("keeps an abort on an established keep-alive connection distinct from its earlier accepted session", async () => {
  let requests = 0;
  let connections = 0;
  const server = createServer((incoming, response) => {
    requests++;
    if (requests === 1) response.end('{"state":"authenticated"}');
    else incoming.socket.destroy();
  });
  server.on("connection", () => {
    connections++;
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing loopback address");
  vi.stubEnv(
    "FULLSTACK_WEB_BASE_URL",
    `http://127.0.0.1:${String(address.port)}`,
  );
  const client = await request.newContext();
  cleanup.push(() => client.dispose());
  expect(await fullStackSessionState({ request: client })).toBe(
    "authenticated",
  );
  await expect(fullStackSessionState({ request: client })).rejects.toThrow(
    "phase=request code=ECONNRESET",
  );
  expect(requests).toBe(2);
  expect(connections).toBe(1);
});
