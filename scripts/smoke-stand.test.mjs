// @ts-check
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { describe, it } from "node:test";

import {
  reservePort,
  reservedPortRange,
  startWithRoutes,
  stopServerOnPort,
} from "./smoke-stand.mjs";

/** @param {number} status */
function answer(status) {
  return Promise.resolve({ status });
}

describe("smoke stand", () => {
  it("reserves a port the operating system never hands out by itself", async () => {
    const port = await reservePort();

    assert.equal(port >= reservedPortRange.first, true);
    assert.equal(port <= reservedPortRange.last, true);
  });

  it("skips a busy port and never returns the same port twice", async () => {
    const busy = createServer();
    await new Promise((resolve) =>
      busy.listen(reservedPortRange.first, "127.0.0.1", () => {
        resolve(undefined);
      }),
    );
    try {
      const candidates = [
        reservedPortRange.first,
        reservedPortRange.first + 1,
        reservedPortRange.first + 1,
        reservedPortRange.first + 2,
      ];
      const pick = () => candidates.shift() ?? reservedPortRange.last;

      assert.equal(await reservePort(pick), reservedPortRange.first + 1);
      assert.equal(await reservePort(pick), reservedPortRange.first + 2);
    } finally {
      await new Promise((resolve) => busy.close(resolve));
    }
  });

  it("restarts a server that came up without a route the scenario opens", async () => {
    /** @type {string[]} */
    const events = [];
    let started = 0;

    const server = await startWithRoutes({
      baseUrl: "http://stand.test",
      routes: ["/", "/products/platform-inside"],
      start: () => {
        started += 1;
        events.push(`start ${String(started)}`);
        return started;
      },
      stop: (instance) => {
        events.push(`stop ${String(instance)}`);
        return Promise.resolve();
      },
      ready: () => Promise.resolve(),
      request: (url) =>
        answer(started === 1 && url.endsWith("/platform-inside") ? 404 : 200),
      log: () => {},
    });

    assert.equal(server, 2);
    assert.deepEqual(events, ["start 1", "stop 1", "start 2"]);
  });

  it("fails loudly when the route never registers", async () => {
    let stopped = 0;

    await assert.rejects(
      startWithRoutes({
        baseUrl: "http://stand.test",
        routes: ["/products/platform-inside"],
        start: () => "server",
        stop: () => {
          stopped += 1;
          return Promise.resolve();
        },
        ready: () => Promise.resolve(),
        request: () => answer(404),
        log: () => {},
      }),
      /404 for \/products\/platform-inside after 3 starts/u,
    );
    assert.equal(stopped, 3);
  });

  it("stops a server with its process group and waits for the port", async () => {
    const port = await reservePort();
    const child = spawn(
      process.execPath,
      [
        "-e",
        `require("node:net").createServer().listen(${String(port)}, "127.0.0.1")`,
      ],
      { detached: true, stdio: "ignore" },
    );
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const busy = await new Promise((resolve) => {
          const probe = createServer();
          probe.once("error", () => {
            resolve(true);
          });
          probe.listen(port, "127.0.0.1", () => {
            probe.close(() => {
              resolve(false);
            });
          });
        });
        if (busy) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await stopServerOnPort(child, port);

      assert.equal(child.signalCode, "SIGTERM");
      // A second stop of a child that a signal ended returns at once instead of waiting for an exit.
      await stopServerOnPort(child, port);
    } finally {
      child.kill("SIGKILL");
    }
  });
});
