// @ts-check
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { describe, it } from "node:test";

import {
  createPortAllocator,
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
    await assert.rejects(
      reservePort(() => port),
      /No free test port in the reserved range/u,
    );
  });

  it("skips a busy port and never returns the same port twice", async () => {
    /** @type {number[]} */
    const probed = [];
    const allocate = createPortAllocator((port) => {
      probed.push(port);
      return Promise.resolve(port !== reservedPortRange.first);
    });
    const candidates = [
      reservedPortRange.first,
      reservedPortRange.first + 1,
      reservedPortRange.first + 1,
      reservedPortRange.first + 2,
    ];
    const pick = () => {
      const port = candidates.shift();
      assert.ok(port !== undefined, "allocator exhausted the test candidates");
      return port;
    };

    assert.equal(await allocate(pick), reservedPortRange.first + 1);
    assert.equal(await allocate(pick), reservedPortRange.first + 2);
    assert.deepEqual(probed, [
      reservedPortRange.first,
      reservedPortRange.first + 1,
      reservedPortRange.first + 2,
    ]);
  });

  it("keeps handed-out ports local to each allocator", async () => {
    const previous = createPortAllocator(() => Promise.resolve(true));
    const current = createPortAllocator(() => Promise.resolve(true));
    const pick = () => reservedPortRange.first + 2;

    assert.equal(await previous(pick), reservedPortRange.first + 2);
    assert.equal(await current(pick), reservedPortRange.first + 2);
    await assert.rejects(
      current(pick),
      /No free test port in the reserved range/u,
    );
  });

  it("rejects a port held by a real loopback server", async () => {
    const busy = createServer();
    try {
      await new Promise((resolve, reject) => {
        busy.once("error", reject);
        busy.listen(0, "127.0.0.1", () => {
          resolve(undefined);
        });
      });
      const address = busy.address();
      assert.ok(address !== null && typeof address !== "string");
      const allocate = createPortAllocator();
      await assert.rejects(
        allocate(() => address.port),
        /No free test port in the reserved range/u,
      );
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
        /** @type {boolean} */
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

  it("starts the dev server of every browser scenario through the route check", async () => {
    // Локальные стенды для ручной проверки держат сервер для человека и маршруты не проверяют.
    const manualStands = new Set([
      "editor-local-review.mjs",
      "telegram-sign-in-local.mjs",
    ]);
    const scripts = (await readdir(new URL(".", import.meta.url))).filter(
      (name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"),
    );
    /** @type {string[]} */
    const scenarios = [];

    for (const script of scripts) {
      const source = await readFile(new URL(script, import.meta.url), "utf8");
      if (manualStands.has(script) || !/"@inside\/web",\s+"dev"/u.test(source))
        continue;
      scenarios.push(script);

      assert.match(source, /await startWithRoutes\(\{/u, script);
      // Command-tree cleanup is exercised through real CLI processes in contracts.
    }
    assert.deepEqual(scenarios, [
      "billing-contact-proof.mjs",
      "buyer-journey-smoke.mjs",
      "enrollment-browser-smoke.mjs",
      "identity-hardening-proof.mjs",
    ]);
  });
});
