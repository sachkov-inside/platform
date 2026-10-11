import { createRequire } from "node:module";
import { z } from "zod";

import type * as AuthModule from "testcontainers/build/container-runtime/auth/get-auth-config.js";
import type * as LoggerModule from "testcontainers/build/common/logger.js";

import { getContainerRuntimeClient } from "testcontainers/build/container-runtime/clients/client.js";
import { ImageName } from "testcontainers/build/container-runtime/image-name.js";

import {
  observeAuth,
  observeExists,
  observePull,
  observeRequest,
  acquireSelectedImage,
  safeImage,
  safePullEvent,
} from "../../../../../scripts/acquisition-diagnostic.mjs";
import { NOTIFICATION_BROKER_IMAGE } from "../../../src/infrastructure/notification-transport/topology.js";

// This is an acquisition-only entrypoint, never a Vitest case or a normal CI test command.
const require = createRequire(import.meta.url);
const {
  DEBUG: debug,
  DOCKER_HOST: dockerHost,
  DOCKER_CONFIG: dockerConfig,
  DOCKER_AUTH_CONFIG: dockerAuthConfig,
  ACQUISITION_DIAGNOSTIC_IMAGE: selection,
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
  if (selection !== "rabbitmq")
    throw new Error("Explicit RabbitMQ selection required");
  const runtime = await getContainerRuntimeClient();
  // The pinned DockerImageClient owns this transport. Reject an unsupported layout before acquisition.
  const driver: unknown = Object.getOwnPropertyDescriptor(
    runtime.image,
    "dockerode",
  )?.value;
  const transport = z
    .custom<Parameters<typeof observeRequest>[0]>(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        "pull" in value &&
        typeof value.pull === "function",
    )
    .parse(driver);
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
    provider: "public.ecr.aws",
    processPid: process.pid,
  });
  const restorePull = observePull(runtime.image, emit);
  const restoreExists = observeExists(runtime.image, emit);
  const restoreAuth = observeAuth(auth, emit);
  const restoreRequest = observeRequest(transport, emit);
  // eslint-disable-next-line typescript/unbound-method -- called with the original receiver and restored in finally.
  const originalTrace = logger.pullLog.trace;
  logger.pullLog.trace = function (message, options) {
    const event: unknown = JSON.parse(message);
    originalTrace.call(this, JSON.stringify(safePullEvent(event)), {
      imageName: safeImage(options?.imageName ?? ""),
    });
  };
  try {
    // GenericContainer.start's normal acquisition arguments, before broker/container creation.
    await acquireSelectedImage(
      runtime.image,
      ImageName.fromString(NOTIFICATION_BROKER_IMAGE),
      selection,
      emit,
    );
    emit({ event: "acquisition-complete" });
  } finally {
    logger.pullLog.trace = originalTrace;
    restoreRequest();
    restoreAuth();
    restoreExists();
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
