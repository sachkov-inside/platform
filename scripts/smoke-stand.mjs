// @ts-check
import { createServer } from "node:net";

import { signalProcessGroup } from "./process-group-signal.mjs";

/**
 * Ports below both ephemeral ranges (Linux starts at 32768, macOS at 49152). `listen(0)` and Docker
 * port mappings never pick from here, so a reserved port stays free until its own server binds it.
 * A port taken from `listen(0)` and released does not: the next `listen(0)` of the stand may get it
 * back, and the server the port was meant for then fails with `EADDRINUSE` (#863).
 */
export const reservedPortRange = { first: 20_000, last: 29_999 };

/** @type {Set<number>} */
const handedOut = new Set();

function randomReservedPort() {
  const size = reservedPortRange.last - reservedPortRange.first + 1;
  return reservedPortRange.first + Math.floor(Math.random() * size);
}

/** @param {number} port */
async function bindsOnLoopback(port) {
  const server = createServer();
  /** @type {Promise<boolean>} */
  const bound = new Promise((resolve) => {
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, "127.0.0.1", () => {
      resolve(true);
    });
  });
  if (!(await bound)) return false;
  await new Promise((resolve) => server.close(resolve));
  return true;
}

/**
 * A free loopback port for a stand server that binds it later.
 *
 * @param {() => number} [pick]
 */
export async function reservePort(pick = randomReservedPort) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = pick();
    if (handedOut.has(port) || !(await bindsOnLoopback(port))) continue;
    handedOut.add(port);
    return port;
  }
  throw new Error("No free test port in the reserved range");
}

/**
 * Stops a detached child with its whole process group and waits for it to exit.
 *
 * @param {import("node:child_process").ChildProcess} child
 */
export async function stopProcessGroup(child) {
  // A child that never started has no process group to stop.
  if (child.exitCode !== null || child.pid === undefined) return;
  signalProcessGroup(child.pid, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.on("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);
  if (child.exitCode === null) signalProcessGroup(child.pid, "SIGKILL");
}

const routeStarts = 3;

/**
 * Starts the web dev server and returns it only when every route the scenario opens is registered.
 *
 * The Turbopack dev server of Next.js 16 can report `Ready` with a partial route graph on a CI
 * runner. A route missing from it answers 404 for the life of the process; only a restart recovers
 * (vercel/next.js#98985, #96139). Our pages answer an unknown address with 200 (ADR 0027), so a 404
 * here means the route itself is missing, not its data.
 *
 * @template Server
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {readonly string[]} options.routes
 * @param {() => Server} options.start
 * @param {(server: Server) => Promise<void>} options.stop
 * @param {(server: Server) => Promise<unknown>} options.ready
 * @param {(url: string) => Promise<{ status: number }>} [options.request]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<Server>}
 */
export async function startWithRoutes({
  baseUrl,
  routes,
  start,
  stop,
  ready,
  request = (url) => fetch(url, { redirect: "manual" }),
  log = (message) => {
    process.stdout.write(`${message}\n`);
  },
}) {
  /** @type {string[]} */
  let missing = [];
  for (let attempt = 1; attempt <= routeStarts; attempt += 1) {
    const server = start();
    await ready(server);
    missing = [];
    for (const route of routes) {
      const { status } = await request(`${baseUrl}${route}`);
      if (status === 404) missing.push(route);
    }
    if (missing.length === 0) return server;
    log(
      `Dev server start ${String(attempt)} has no route for ${missing.join(", ")}; stopping it.`,
    );
    await stop(server);
  }
  throw new Error(
    `Dev server has no route for ${missing.join(", ")} after ${String(routeStarts)} starts (vercel/next.js#98985)`,
  );
}
