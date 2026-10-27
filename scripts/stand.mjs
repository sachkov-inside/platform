// @ts-check
import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";
import { controlStand } from "./stand-controller.mjs";
import { createStandRuntime } from "./stand-runtime.mjs";
import { readStandSource } from "./stand-source.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    worktree: { type: "string" },
    replace: { type: "string" },
    live: { type: "boolean" },
    "production-web": { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  process.stdout
    .write(`Usage: pnpm stand [status|show|refresh|release] [--worktree PATH] [--live|--production-web] [--replace RESERVATION_ID] [--json]

status   Inspect the shared stand and its durable review reservation.
show     Prepare this worktree and reserve it for review.
refresh  Update this worktree, preserving its current preview mode.
release  Release the reservation; keep the application running.

--live connects Web app/src/public to the development server. Other edits need refresh.
--replace requires the current reservation ID and an explicit owner request to change tasks.
`);
} else {
  try {
    const command = z
      .enum(["status", "show", "refresh", "release"])
      .parse(positionals[0] ?? "status");
    if (positionals.length > 1 || (values.live && values["production-web"]))
      throw new Error("Choose one command and one preview mode; use --help");
    if (
      (command === "status" || command === "release") &&
      (values.live || values["production-web"])
    )
      throw new Error("Preview mode applies to show and refresh only");
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
    const runtime = createStandRuntime({
      root: controller,
      directory,
      pnpmPath: pnpmPath ?? "",
    });
    const result = await controlStand(
      {
        command,
        worktree,
        ...(values.replace ? { replace: z.uuid().parse(values.replace) } : {}),
        ...(values.live
          ? { mode: "live" }
          : values["production-web"]
            ? { mode: "production" }
            : {}),
      },
      {
        directory,
        controller,
        ...runtime,
        acquire: () =>
          acquireLocalSetupLock(
            "Another stand operation is running; inspect status and retry when it finishes",
          ),
        source: readStandSource,
        baseline: () => readStandSource(controller),
      },
    );
    if (values.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else {
      process.stdout.write(`Stand: ${result.status}\n`);
      if (result.source)
        process.stdout.write(
          `Worktree: ${result.source.root}\nSource: ${result.source.head}\nMode: ${result.mode}\n`,
        );
      process.stdout.write(
        result.reservation
          ? `Reserved: ${result.reservation.worktree}\nReservation: ${result.reservation.id}\n`
          : "Review reservation: free\n",
      );
      if (result.url) process.stdout.write(`${result.url}\n`);
      process.stdout.write(`Controller: ${result.controller}\n`);
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
