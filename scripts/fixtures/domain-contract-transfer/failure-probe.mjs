/** Exercises the same diagnostic lifetime owner with real isolated resources and forced failures. */
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnOwned } from "../../owned-process.mjs";
import { commandExit } from "../../diagnostic-command.mjs";
import {
  bounded,
  createTransferOwnership,
  stopDiagnosticChild,
} from "./lifetime.mjs";
const [scenario, output] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const ownership = await createTransferOwnership(output);
const children = new Set();
let server;
let failure;
const cleanup = [];
try {
  await ownership.postgres();
  process.stdout.write(
    JSON.stringify({
      phase: "probe-ready",
      name: ownership.name,
      pid: process.pid,
    }) + "\n",
  );
  if (scenario === "hung-child") {
    const child = spawnOwned(
      process.execPath,
      [
        "-e",
        'process.on("SIGTERM",()=>{});console.log("READY");setInterval(()=>{},1000)',
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.add(child);
    await bounded(
      "forced child readiness",
      10_000,
      () => new Promise((ready) => child.stdout.once("data", ready)),
    );
    await bounded(
      "forced stuck capability",
      200,
      () => commandExit(child),
      ownership.signal,
    );
  } else if (scenario === "slow-header" || scenario === "slow-body") {
    server = createServer((_request, response) => {
      if (scenario === "slow-body") {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"unfinished":');
      }
    });
    await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
    await bounded(
      "forced HTTP/body",
      200,
      async (signal) => {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}`,
          { signal },
        );
        await response.json();
      },
      ownership.signal,
    );
  } else if (scenario === "wait-interrupt" || scenario === "kill-acquiring") {
    await bounded(
      "interruption probe",
      60_000,
      () => new Promise(() => {}),
      ownership.signal,
    );
  } else if (scenario === "cleanup-failure") {
    await writeFile(resolve(output, "fail-observation"), "forced");
    throw new Error("Original forced failure before cleanup");
  } else if (scenario !== "success")
    throw new Error("Unknown lifetime proof scenario");
} catch (error) {
  failure = String(error.message);
  process.exitCode ||= 1;
} finally {
  for (const child of [...children]) {
    try {
      await stopDiagnosticChild(child, children);
      cleanup.push({
        resource: "child",
        code: child.exitCode,
        signal: child.signalCode,
        success: true,
      });
    } catch (error) {
      cleanup.push({
        resource: "child",
        success: false,
        failure: String(error.message),
      });
      process.exitCode ||= 1;
    }
  }
  if (server) {
    const closed = new Promise((yes, no) =>
      server.close((error) => (error ? no(error) : yes())),
    );
    server.closeAllConnections();
    await bounded("probe server cleanup", 10_000, () => closed);
  }
  try {
    cleanup.push(...(await ownership.close()));
  } catch (error) {
    cleanup.push({
      resource: "ownership",
      success: false,
      failure: String(error.message),
    });
    process.exitCode ||= 1;
  }
  if (cleanup.some((result) => !result.success)) process.exitCode ||= 1;
  await writeFile(
    resolve(output, "probe.json"),
    JSON.stringify(
      {
        scenario,
        failure,
        cleanup,
        activeChildren: children.size,
        exitCode: process.exitCode ?? 0,
      },
      null,
      2,
    ),
  );
}
