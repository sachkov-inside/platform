import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  resolveRuntimeIdentity,
  runtimeIdentitySchema,
  sha256IdentitySchema,
  type RuntimeIdentity,
} from "@inside/runtime-identity";
import { z } from "zod";

import { parsePlatformDatabaseConfig } from "../config/platform-config.js";
import { platformMigrations } from "../migrations/index.js";
import { runtimeSchemaReadiness } from "../migrations/runtime-schema.js";
import { verifyMigrationState } from "./postgres/migrate-to-latest.js";
import { WORKER_READINESS_PATH } from "./worker-readiness-marker.js";

const workerProcessSchema = z.enum([
  "material-assets-worker",
  "profile-avatars-worker",
  "video-deletions-worker",
  "notifications-worker",
  "billing-worker",
]);
const readinessMarkerSchema = z
  .object({
    database: z.literal("reachable"),
    process: workerProcessSchema,
    release: runtimeIdentitySchema,
    schema: z
      .object({
        identity: sha256IdentitySchema,
        migrationCount: z.number().int().nonnegative(),
      })
      .strict(),
    status: z.literal("ready"),
  })
  .strict();

export async function assertCurrentWorkerReadiness(input: {
  readonly databaseUrl: string;
  readonly expectedRelease: RuntimeIdentity;
}): Promise<void> {
  const marker = readinessMarkerSchema.parse(
    JSON.parse(await readFile(WORKER_READINESS_PATH, "utf8")),
  );
  if (
    marker.release.release !== input.expectedRelease.release ||
    marker.release.sourceSha !== input.expectedRelease.sourceSha
  ) {
    throw new Error(
      "Worker readiness marker does not match this process release",
    );
  }

  const schema = runtimeSchemaReadiness(
    await verifyMigrationState(input.databaseUrl, platformMigrations),
  );
  if (
    marker.schema.identity !== schema.identity ||
    marker.schema.migrationCount !== schema.migrationCount
  ) {
    throw new Error("Worker readiness marker has a stale schema identity");
  }
}

async function main(): Promise<void> {
  const database = parsePlatformDatabaseConfig(process.env, "production");
  const expectedRelease = resolveRuntimeIdentity({
    environment: process.env,
    mode: "production",
  });
  await assertCurrentWorkerReadiness({
    databaseUrl: database.url,
    expectedRelease,
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch(async (error: unknown) => {
    // Healthy probes need neither the logging runtime nor its telemetry dependencies.
    const { describeError, writeLog } = await import("./observability/log.js");
    writeLog("error", "healthcheck_failed", { error: describeError(error) });
    process.exitCode = 1;
  });
}
