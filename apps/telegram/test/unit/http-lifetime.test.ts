import { deferred } from "../support/deferred.js";
// deterministic-test-allow unit-io: owns native Fastify and loopback HTTP; finally closes both listener and client.
import { request } from "node:http";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { HttpLifetime } from "../../src/application/http-lifetime.js";

for (const outcome of ["completed", "rejected"])
  it(`keeps a disconnected native HTTP handler owned until its work settles (${outcome})`, async () => {
    const server = Fastify();
    const lifetime = new HttpLifetime(server);
    const entered = deferred();
    const released = deferred();
    const completed = deferred();
    const original = new Error("synthetic admitted handler failure");
    server.get("/held", async () => {
      entered.resolve();
      await released.promise;
      completed.resolve();
      if (outcome === "rejected") throw original;
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
      const closed = deferred();
      client.once("close", () => closed.resolve());
      client.destroy();
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
      expect(await draining).toEqual({
        quiescent: true,
        failures: outcome === "rejected" ? [original] : [],
      });
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
  server.addHook("onClose", () => Promise.reject(original));
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

it("closes technical HTTP admission with the existing shutdown response before invoking a route", async () => {
  const server = Fastify();
  const lifetime = new HttpLifetime(server);
  let handled = 0;
  server.get("/closed", () => {
    handled += 1;
    return { accepted: true };
  });
  try {
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing listener");
    lifetime.closeAdmission();
    // deterministic-test-allow unit-io: owns this native loopback listener and consumes its complete shutdown response; finally drains and closes it.
    const response = await fetch(`http://127.0.0.1:${address.port}/closed`);
    expect(response.status).toBe(503);
    expect(response.headers.get("connection")).toBe("close");
    expect(await response.json()).toEqual({
      error: "Service Unavailable",
      message: "Service Unavailable",
      statusCode: 503,
    });
    expect(handled).toBe(0);
  } finally {
    lifetime.beginStop();
    await lifetime.drain();
    await server.close();
  }
});

it("does not retain historical request errors after their response already settled", async () => {
  const server = Fastify();
  const lifetime = new HttpLifetime(server);
  server.get("/failed", () =>
    Promise.reject(new Error("synthetic prior request")),
  );
  try {
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing listener");
    // deterministic-test-allow unit-io: this owned loopback response proves the failed request settled before shutdown; finally closes the public lifetime.
    const response = await fetch(`http://127.0.0.1:${address.port}/failed`);
    expect(response.status).toBe(500);
    await response.arrayBuffer();
    lifetime.beginStop();
    expect((await lifetime.drain()).failures).toEqual([]);
  } finally {
    lifetime.beginStop();
    await lifetime.drain();
    await server.close();
  }
});
