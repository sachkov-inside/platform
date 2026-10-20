import { deferred } from "../support/deferred.js";
// deterministic-test-allow unit-io: owns native Fastify and loopback HTTP; finally closes both listener and client.
import { request } from "node:http";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { HttpLifetime } from "../../src/application/http-lifetime.js";

it("keeps a disconnected native HTTP handler owned until its work settles", async () => {
  const server = Fastify();
  const lifetime = new HttpLifetime(server);
  const entered = deferred<void>();
  const released = deferred<void>();
  const completed = deferred<void>();
  server.get("/held", async () => {
    entered.resolve();
    await released.promise;
    completed.resolve();
    return { done: true };
  });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing listener");
  const client = request({
    host: "127.0.0.1",
    port: address.port,
    path: "/held",
  });
  client.on("error", () => undefined);
  client.end();
  try {
    await entered.promise;
    client.destroy();
    const closed = deferred<void>();
    client.once("close", () => closed.resolve());
    await closed.promise;
    lifetime.beginStop();
    let drained = false;
    const draining = lifetime.drain().then((report) => {
      drained = true;
      return report;
    });
    await Promise.resolve();
    expect(lifetime.isQuiescent()).toBe(false);
    expect(drained).toBe(false);
    released.resolve();
    await completed.promise;
    expect(await draining).toEqual({ quiescent: true, failures: [] });
    expect(lifetime.isQuiescent()).toBe(true);
  } finally {
    released.resolve();
    client.destroy();
    lifetime.beginStop();
    await lifetime.drain();
    await server.close();
  }
});

it("preserves a native framework close error after the listener has actually stopped", async () => {
  const server = Fastify();
  const lifetime = new HttpLifetime(server);
  const original = new Error("synthetic native close");
  server.addHook("onClose", async () => {
    throw original;
  });
  await server.listen({ host: "127.0.0.1", port: 0 });
  try {
    lifetime.beginStop();
    const report = await lifetime.drain();
    expect(report.failures).toEqual([original]);
    expect(report.failures[0]).toBe(original);
    expect(lifetime.isQuiescent()).toBe(true);
    await lifetime.whenQuiescent();
  } finally {
    await server.close().catch(() => undefined);
  }
});
