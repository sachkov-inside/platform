// @ts-check
import { execFileSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";
import { pnpmInvocation } from "./pnpm-invocation.mjs";
import {
  controlStand,
  planPrebuild,
  readReservation,
} from "./stand-controller.mjs";
import { readStandQueue, waitForStandTurn } from "./stand-queue.mjs";
import { createStandRuntime } from "./stand-runtime.mjs";
import { readStandSource } from "./stand-source.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    worktree: { type: "string" },
    replace: { type: "string" },
    "if-owned": { type: "boolean" },
    live: { type: "boolean" },
    "production-web": { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  process.stdout
    .write(`Usage: pnpm stand [status|show|refresh|release|upgrade] [--worktree PATH] [--live|--production-web] [--replace RESERVATION_ID] [--json]

status   Inspect the shared stand and its durable review reservation.
show     Prepare this worktree and reserve it for review.
refresh  Update this worktree, preserving its current preview mode.
release  Release the reservation; keep the application running. With --if-owned, release only
         this worktree's reservation, leave any other one and exit 0.
upgrade  Move the running stand forward to this worktree's schema and infrastructure,
         keeping its data. Dumps the databases first; an owner request is required.

--live connects Web app/src/public to the development server. Other edits need refresh.
--replace requires the current reservation ID and an explicit owner request to change tasks.
`);
} else {
  try {
    const command = z
      .enum(["status", "show", "refresh", "release", "upgrade"])
      .parse(positionals[0] ?? "status");
    if (positionals.length > 1 || (values.live && values["production-web"]))
      throw new Error("Choose one command and one preview mode; use --help");
    if (
      (command === "status" || command === "release") &&
      (values.live || values["production-web"])
    )
      throw new Error("Preview mode applies to show, refresh and upgrade only");
    if (values["if-owned"] && command !== "release")
      throw new Error("--if-owned applies to release only");
    if (values.replace && command !== "show" && command !== "upgrade")
      throw new Error("--replace applies to show and upgrade only");
    for (const name of [
      "COMPOSE_FILE",
      "COMPOSE_PROFILES",
      "COMPOSE_ENV_FILES",
    ]) {
      if (process.env[name])
        throw new Error(
          `Unset ${name}; the stand controller selects its Compose configuration`,
        );
    }
    const controller = await realpath(
      resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    );
    const requested = resolve(
      values.worktree ?? process.env["INIT_CWD"] ?? process.cwd(),
    );
    const worktree = await realpath(
      git(requested, ["rev-parse", "--show-toplevel"]),
    );
    const common = await commonDirectory(controller);
    if ((await commonDirectory(worktree)) !== common)
      throw new Error("Choose a worktree of the controller's repository");
    const directory = join(common, "inside-platform-stand");
    const pnpmPath = process.env["npm_execpath"];
    if (command !== "status" && !pnpmPath)
      throw new Error(
        "Run mutations through pnpm stand; use --worktree for another checkout",
      );
    // `release --if-owned` may finish here: nothing of this worktree to release, or the
    // registered controller released it.
    const handled =
      values["if-owned"] === true &&
      (await releaseIfOwnedElsewhere(
        directory,
        worktree,
        controller,
        pnpmPath ?? "",
      ));
    if (!handled) {
      const runtime = createStandRuntime({
        directory,
        pnpmPath: pnpmPath ?? "",
      });
      /** @type {import("./stand-controller.mjs").StandRequest} */
      const request = {
        command,
        worktree,
        ...(values.replace ? { replace: z.uuid().parse(values.replace) } : {}),
        ...(values["if-owned"] ? { ifOwned: true } : {}),
        ...(values.live
          ? { mode: "live" }
          : values["production-web"]
            ? { mode: "production" }
            : {}),
      };
      // Image builds need only the source: they run before the operation joins the queue, so the
      // stand is held while it is changed, not while the source compiles.
      if (
        command === "show" ||
        command === "refresh" ||
        command === "upgrade"
      ) {
        const mode = await planPrebuild(
          request,
          { directory, worktreeExists },
          await readStandSource(worktree),
        );
        if (mode !== null) {
          await runtime.inspect();
          await runtime.prebuild(worktree, mode);
        }
      }
      const result = await controlStand(request, {
        directory,
        controller,
        ...runtime,
        acquire: () =>
          waitForStandTurn({
            directory,
            worktree,
            command,
            acquire: () =>
              acquireLocalSetupLock(
                "Another stand operation holds the machine-wide lock",
              ),
            report: (message) => process.stderr.write(`${message}\n`),
          }),
        source: readStandSource,
        baseline: () => readStandSource(controller),
        worktreeExists,
      });
      const queue = command === "status" ? await readStandQueue(directory) : [];
      if (values.json)
        process.stdout.write(
          `${JSON.stringify(command === "status" ? { ...result, queue } : result)}\n`,
        );
      else {
        process.stdout.write(`Stand: ${result.status}\n`);
        if (result.source)
          process.stdout.write(
            `Worktree: ${result.source.root}\nSource: ${result.source.head}\nMode: ${result.mode}\n`,
          );
        if (result.releasedStale)
          process.stdout.write(
            `Released reservation ${result.releasedStale.id}: worktree ${result.releasedStale.worktree} no longer exists\n`,
          );
        process.stdout.write(
          result.reservation
            ? `Reserved: ${result.reservation.worktree}${result.reservation.worktreeMissing ? " (worktree no longer exists; the next stand operation releases it)" : ""}\nReservation: ${result.reservation.id}\nReserved for: ${result.reservation.ageSeconds === null ? "unknown (taken before reservation times were recorded)" : formatAge(result.reservation.ageSeconds)}\n`
            : "Review reservation: free\n",
        );
        for (const [index, entry] of queue.entries())
          process.stdout.write(
            `Queue ${String(index + 1)}: ${entry.worktree} ${entry.command} (since ${entry.enqueuedAt})\n`,
          );
        if (result.url) process.stdout.write(`${result.url}\n`);
        process.stdout.write(`Controller: ${result.controller}\n`);
      }
    }
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "Invalid stand input or runtime response; use --help"
        : error instanceof Error
          ? error.message
          : "Stand command failed";
    if (values.json)
      process.stdout.write(`${JSON.stringify({ status: "error", message })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

/**
 * `release --if-owned` leaves a foreign or missing reservation alone without Docker or the lock.
 * Mutations run in the registered controller checkout, so a reservation of this worktree is
 * released there on its behalf; the controller checks ownership again under the lock.
 * @param {string} directory @param {string} worktree @param {string} controller
 * @param {string} pnpmPath
 * @returns {Promise<boolean>} true when nothing is left for this process to do
 */
async function releaseIfOwnedElsewhere(
  directory,
  worktree,
  controller,
  pnpmPath,
) {
  const current = await readReservation(directory);
  if (current?.reservation?.worktree !== worktree) {
    const message = current?.reservation
      ? `Reservation belongs to ${current.reservation.worktree}; left in place`
      : "No reservation to release";
    process.stdout.write(
      values.json
        ? `${JSON.stringify({ status: "unchanged", reservation: current?.reservation ?? null, message })}\n`
        : `${message}\n`,
    );
    return true;
  }
  if (current.controller === controller) return false;
  if (!(await worktreeExists(current.controller)))
    throw new Error(
      `The registered stand controller ${current.controller} no longer exists; the reservation stays until the owner hands the stand over`,
    );
  const [executable, args] = pnpmInvocation(pnpmPath, [
    "--dir",
    current.controller,
    "stand",
    "release",
    "--if-owned",
    "--worktree",
    worktree,
    ...(values.json ? ["--json"] : []),
  ]);
  try {
    execFileSync(executable, args, { stdio: "inherit" });
  } catch (error) {
    // The controller already reported its failure; only pass its exit status on.
    process.exitCode =
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 1;
  }
  return true;
}

/** @param {string} path */
async function worktreeExists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** @param {number} seconds */
function formatAge(seconds) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0
    ? `${String(hours)} h ${String(minutes)} min`
    : `${String(minutes)} min`;
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** @param {string} root */
async function commonDirectory(root) {
  return realpath(resolve(root, git(root, ["rev-parse", "--git-common-dir"])));
}
