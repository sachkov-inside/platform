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

const stopGraceMilliseconds = 10_000;
const portReleaseMilliseconds = 15_000;
const probeTimeoutMilliseconds = 60_000;

/** @param {number} milliseconds */
function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Stops a detached child with its whole process group and waits for it to exit.
 *
 * @param {import("node:child_process").ChildProcess} child
 */
export async function stopProcessGroup(child) {
  // A child that never started has no process group to stop; one killed by a signal has no exit code.
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  )
    return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  signalProcessGroup(child.pid, "SIGTERM");
  await Promise.race([exited, pause(stopGraceMilliseconds)]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcessGroup(child.pid, "SIGKILL");
  await Promise.race([exited, pause(stopGraceMilliseconds)]);
}

/**
 * Stops the dev server and waits until its port can be bound again. `pnpm` exits before the
 * `next dev` process it started lets go of the port, and a restart on a busy port fails.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {number} port
 */
export async function stopServerOnPort(child, port) {
  await stopProcessGroup(child);
  const end = Date.now() + portReleaseMilliseconds;
  while (Date.now() < end) {
    if (await bindsOnLoopback(port)) return;
    await pause(250);
  }
  throw new Error(`Port ${String(port)} is still busy after the server stop`);
}

const routeStarts = 3;

/**
 * Starts the web dev server and returns it only when every route the scenario opens is registered.
 *
 * The Turbopack dev server of Next.js 16 can report `Ready` with a partial route graph on a CI
 * runner. A route missing from it answers 404 for the life of the process; only a restart recovers
 * (vercel/next.js#98985, #96139). In CI the stand came up without `/products/[slug]` or without
 * `/products/[slug]/buy` about once in fifty starts (#863).
 *
 * The status alone cannot tell a missing route from a page that calls `notFound()` for missing
 * data, so a 404 that survives every start fails the smoke and names both causes. List the address
 * of every page and route handler the scenario reaches; give a handler that answers 404 to a bare
 * GET the query it needs to answer something else.
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
  request = (url) =>
    fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(probeTimeoutMilliseconds),
    }),
  log = (message) => {
    // GitHub Actions turns the prefix into an annotation, so a restart stays visible on a green run.
    const prefix =
      process.env["GITHUB_ACTIONS"] === "true" ? "::warning::" : "";
    process.stdout.write(`${prefix}${message}\n`);
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
      `Dev server start ${String(attempt)} of ${String(routeStarts)} answers 404 for ${missing.join(", ")}; restarting it (#863).`,
    );
    await stop(server);
  }
  throw new Error(
    `Dev server answers 404 for ${missing.join(", ")} after ${String(routeStarts)} starts. Either the address or its data is gone (fix the scenario, the seed or the route list), or the dev server keeps losing the route (vercel/next.js#98985).`,
  );
}
