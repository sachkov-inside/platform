import { createRequire } from "node:module";

import type * as AuthModule from "testcontainers/build/container-runtime/auth/get-auth-config.js";
import type * as LoggerModule from "testcontainers/build/common/logger.js";

import { getContainerRuntimeClient } from "testcontainers/build/container-runtime/clients/client.js";

import {
  observeAuth,
  observePull,
  runSetupAndTeardown,
  safeImage,
  safePullEvent,
} from "../../../../../scripts/acquisition-diagnostic.mjs";
import {
  spawnOwned,
  stopOwned,
} from "../../../../../scripts/owned-process.mjs";
import { commandExit } from "../../../../../scripts/diagnostic-command.mjs";
import setup from "../../integration/setup/postgres.global.js";

// This is an acquisition-only entrypoint, never a Vitest case or a normal CI test command.
const require = createRequire(import.meta.url);
const {
  DEBUG: debug,
  DOCKER_HOST: dockerHost,
  DOCKER_CONFIG: dockerConfig,
  DOCKER_AUTH_CONFIG: dockerAuthConfig,
} = process.env;
/* oxlint-disable typescript/no-unsafe-type-assertion -- pinned SDK CJS exports share the actual setup's module cache. */
const auth =
  require("testcontainers/build/container-runtime/auth/get-auth-config.js") as typeof AuthModule;
const logger =
  require("testcontainers/build/common/logger.js") as typeof LoggerModule;
/* oxlint-enable typescript/no-unsafe-type-assertion */
let emittedBytes = 0;
function emit(record: { event: string; [key: string]: unknown }) {
  const line = `${JSON.stringify(record)}\n`;
  emittedBytes += Buffer.byteLength(line);
  // The hosted supervisor independently enforces its combined 1 MiB diagnostics budget.
  if (emittedBytes <= 1024 * 1024) process.stdout.write(line);
}

async function main() {
  if (process.platform !== "linux" || debug !== "testcontainers:pull")
    throw new Error("Requires Linux and selected pull DEBUG");
  // Preserve the real job's native SQL prerequisite; never expose captured provider free text.
  const sql = spawnOwned(
    "python3",
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/production-verify",
      "-p",
      "test_sql.py",
    ],
    {
      stdio: "ignore",
      env: { ...process.env, PRODUCTION_VERIFY_SQL_TEST: "1" },
    },
  );
  try {
    const exit = await commandExit(sql);
    emit({ event: "sql-prerequisite", exit });
    if (exit !== 0) {
      process.exitCode = exit ?? 1;
      return;
    }
  } finally {
    await stopOwned(sql);
  }

  const runtime = await getContainerRuntimeClient();
  emit({
    event: "runtime",
    nodeArchitecture: process.arch,
    daemonArchitecture:
      runtime.info.containerRuntime.architecture === "x86_64" ||
      runtime.info.containerRuntime.architecture === "aarch64"
        ? runtime.info.containerRuntime.architecture
        : "omitted",
    daemonOs:
      runtime.info.containerRuntime.operatingSystemType === "linux"
        ? "linux"
        : "omitted",
    daemonServerVersion: runtime.info.containerRuntime.serverVersion,
    dockerHostPresent: dockerHost !== undefined,
    dockerConfigOverridePresent: dockerConfig !== undefined,
    dockerAuthConfigPresent: dockerAuthConfig !== undefined,
  });
  const restorePull = observePull(runtime.image, emit);
  const restoreAuth = observeAuth(auth, emit);
  // eslint-disable-next-line typescript/unbound-method -- called with the original receiver and restored in finally.
  const originalTrace = logger.pullLog.trace;
  logger.pullLog.trace = function (message, options) {
    const event: unknown = JSON.parse(message);
    originalTrace.call(this, JSON.stringify(safePullEvent(event)), {
      imageName: safeImage(options?.imageName ?? ""),
    });
  };
  try {
    await runSetupAndTeardown(
      () =>
        setup({
          isRootProject: () => true,
          provide: () => {
            /* Diagnostic discards database context; it never starts test cases. */
          },
        }),
      () => emit({ event: "setup-complete" }),
    );
    emit({ event: "teardown-complete" });
  } finally {
    logger.pullLog.trace = originalTrace;
    restoreAuth();
    restorePull();
  }
}

try {
  await main();
} catch (error) {
  // Keep failure status; only the known primary signal is publishable, never arbitrary error text.
  emit({
    event: "diagnostic-failed",
    rateExceeded:
      error instanceof Error &&
      error.message === "toomanyrequests: Rate exceeded",
  });
  process.exitCode = 1;
}
