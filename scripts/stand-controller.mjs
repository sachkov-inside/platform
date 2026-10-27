// @ts-check
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { standApplicationServices } from "./stand-services.mjs";

const containerSchema = z.strictObject({
  id: z.string(),
  service: z.string(),
  image: z.string(),
  generation: z.string(),
  running: z.boolean(),
  health: z.string().nullable(),
});
const snapshotSchema = z.strictObject({
  daemon: z.string(),
  containers: z.array(containerSchema),
});
const sourceSchema = z.strictObject({
  root: z.string(),
  head: z.string(),
  fingerprint: z.string(),
  build: z.string(),
  schema: z.string(),
  infrastructure: z.string(),
  identity: z.string(),
});
const modeSchema = z.enum(["snapshot", "live", "production"]);
const stateSchema = z.strictObject({
  version: z.literal(1),
  controller: z.string(),
  phase: z.enum(["preparing", "ready", "failed"]),
  generation: z.uuid(),
  reservation: z
    .strictObject({ id: z.uuid(), worktree: z.string() })
    .nullable(),
  source: sourceSchema,
  mode: modeSchema,
  receipt: snapshotSchema.nullable(),
  health: z.strictObject({ schema: z.string(), url: z.url() }).nullable(),
});

/**
 * @typedef {z.infer<typeof snapshotSchema>} StandSnapshot
 * @typedef {z.infer<typeof sourceSchema>} StandSource
 * @typedef {z.infer<typeof stateSchema>} StandState
 * @typedef {z.infer<typeof modeSchema>} StandMode
 * @typedef {{ source: StandSource; mode: StandMode; generation: string; cold: boolean; resumeCold: boolean; recordIdentity: () => Promise<void> }} StandOperation
 * @typedef {{ command: "status" | "show" | "refresh" | "release"; worktree: string; replace?: string; mode?: "snapshot" | "live" | "production" }} StandRequest
 * @typedef {{ directory: string; controller: string; inspect: () => Promise<StandSnapshot>; acquire?: () => Promise<() => Promise<void>>; source?: (root: string) => Promise<StandSource>; baseline?: () => Promise<StandSource>; prepare?: (operation: StandOperation) => Promise<void>; ready?: (snapshot: StandSnapshot) => Promise<{schema: string; url: string}> }} StandDependencies
 */

/** @param {StandRequest} request @param {StandDependencies} dependencies */
export async function controlStand(request, dependencies) {
  if (request.replace !== undefined && request.command !== "show")
    throw new Error("--replace applies to show only");
  if (request.command === "status") return status(dependencies);
  if (
    !dependencies.acquire ||
    !dependencies.source ||
    !dependencies.prepare ||
    !dependencies.ready
  )
    throw new Error(
      "Stand mutations require the shared lock and runtime adapters",
    );
  const release = await dependencies.acquire();
  try {
    const previous = await readState(dependencies.directory);
    if (previous && previous.controller !== dependencies.controller)
      throw new Error(
        `Use the registered stand controller at ${previous.controller} with --worktree ${request.worktree}`,
      );
    const reservation = previous?.reservation;
    if (request.replace !== undefined && request.replace !== reservation?.id)
      throw new Error(
        "The reservation changed; read stand status before replacing it",
      );
    if (
      reservation &&
      reservation.worktree !== request.worktree &&
      request.replace !== reservation.id
    )
      throw new Error(
        `Stand is reserved for ${reservation.worktree} (${reservation.id})`,
      );
    if (request.command === "release") {
      if (previous) {
        previous.reservation = null;
        await writeState(dependencies.directory, previous);
      }
      return status(dependencies);
    }
    const source = sourceSchema.parse(
      await dependencies.source(request.worktree),
    );
    if (!previous && dependencies.baseline) {
      const baseline = sourceSchema.parse(await dependencies.baseline());
      if (
        source.schema !== baseline.schema ||
        source.infrastructure !== baseline.infrastructure
      )
        throw new Error(
          "Initial stand schema and infrastructure must match the controller checkout; prepare a separate handoff for a different baseline",
        );
    }
    if (previous && previous.source.identity !== source.identity)
      throw new Error(
        "Stand identity settings changed outside the controller; preserve the current accounts and obtain a handoff",
      );
    if (
      previous &&
      (previous.source.schema !== source.schema ||
        previous.source.infrastructure !== source.infrastructure)
    )
      throw new Error(
        "Stand schema or infrastructure differs; keep the current stand and prepare a separate migration or infrastructure handoff",
      );
    const snapshot = snapshotSchema.parse(await dependencies.inspect());
    if (
      snapshot.containers.length > 0 &&
      (!previous || !controlledRuntime(previous, snapshot))
    )
      throw new Error(
        "Stand is unmanaged or its containers changed ownership; obtain an owner handoff before changing it",
      );
    const mode =
      request.mode ??
      (request.command === "refresh" && previous?.source.root === source.root
        ? previous.mode
        : "snapshot");
    const sameSource =
      previous?.source.root === source.root &&
      previous.mode === mode &&
      (mode === "live"
        ? previous.source.build === source.build
        : previous.source.fingerprint === source.fingerprint);
    let applicationReady = false;
    if (snapshot.containers.length > 0 && previous?.health) {
      let health;
      try {
        health = await dependencies.ready(snapshot);
        applicationReady = true;
      } catch (error) {
        // Recreate the same code to repair an unavailable app. Unknown database health
        // never authorizes introducing another source or changing preview modes.
        if (request.command !== "refresh" || !sameSource) throw error;
      }
      if (health && health.schema !== previous.health.schema)
        throw new Error(
          "The running database schema changed outside the controller",
        );
    }
    if (
      applicationReady &&
      previous?.phase === "ready" &&
      previous.source.root === source.root &&
      previous.mode === mode &&
      (mode === "live"
        ? previous.source.build === source.build
        : previous.source.fingerprint === source.fingerprint) &&
      sameRuntime(previous.receipt, snapshot)
    ) {
      await dependencies.ready(snapshot);
      previous.reservation = reservation ?? {
        id: randomUUID(),
        worktree: request.worktree,
      };
      previous.source = source;
      await writeState(dependencies.directory, previous);
      return status(dependencies);
    }
    const cold = snapshot.containers.length === 0 || previous?.health === null;
    /** @type {StandState} */
    const state = {
      version: 1,
      controller: dependencies.controller,
      phase: "preparing",
      generation: randomUUID(),
      reservation:
        reservation?.worktree === request.worktree
          ? reservation
          : { id: randomUUID(), worktree: request.worktree },
      source,
      mode,
      receipt: snapshot,
      health: previous?.health ?? null,
    };
    await writeState(dependencies.directory, state);
    try {
      await dependencies.prepare({
        source,
        mode: state.mode,
        generation: state.generation,
        cold,
        resumeCold: cold && snapshot.containers.length > 0,
        recordIdentity: async () => {
          if (!cold)
            throw new Error(
              "Identity bootstrap checkpoint is restricted to cold startup",
            );
          const bootstrapped = sourceSchema.parse(
            await dependencies.source?.(request.worktree),
          );
          state.source.identity = bootstrapped.identity;
          await writeState(dependencies.directory, state);
        },
      });
      const prepared = snapshotSchema.parse(await dependencies.inspect());
      if (
        prepared.daemon !== snapshot.daemon ||
        prepared.containers.some((container) =>
          standApplicationServices.includes(container.service) || cold
            ? container.generation !== state.generation
            : !snapshot.containers.some(
                (old) =>
                  old.id === container.id &&
                  old.image === container.image &&
                  old.service === container.service,
              ),
        ) ||
        (!cold &&
          snapshot.containers.some(
            (old) =>
              !standApplicationServices.includes(old.service) &&
              !prepared.containers.some((container) => container.id === old.id),
          ))
      )
        throw new Error(
          "Stand ownership or infrastructure changed during preparation",
        );
      const health = await dependencies.ready(prepared);
      if (previous?.health && health.schema !== previous.health.schema)
        throw new Error("Database schema changed during preparation");
      const after = sourceSchema.parse(
        await dependencies.source(request.worktree),
      );
      if (
        mode === "live"
          ? after.build !== source.build
          : after.fingerprint !== source.fingerprint
      )
        throw new Error(
          "Source changed during preparation; refresh after edits settle",
        );
      state.source = after;
      state.receipt = prepared;
      state.health = health;
      state.phase = "ready";
      await writeState(dependencies.directory, state);
    } catch (error) {
      state.phase = "failed";
      await writeState(dependencies.directory, state);
      throw error;
    }
    return status(dependencies);
  } finally {
    await release();
  }
}

/** Keep legacy startup from replacing a reserved but stopped controlled stand. @param {string} directory */
export async function requireUnmanagedStand(directory) {
  const state = await readState(directory);
  if (state)
    throw new Error(
      `This stand is managed by ${state.controller}; use its pnpm stand commands`,
    );
}

/** @param {StandSnapshot | null} expected @param {StandSnapshot} actual */
function sameRuntime(expected, actual) {
  return (
    expected !== null &&
    expected.daemon === actual.daemon &&
    expected.containers.length === actual.containers.length &&
    expected.containers.every((container) =>
      actual.containers.some(
        (candidate) =>
          candidate.id === container.id &&
          candidate.service === container.service &&
          candidate.image === container.image &&
          candidate.generation === container.generation,
      ),
    )
  );
}

/** @param {StandState} state @param {StandSnapshot} actual */
function controlledRuntime(state, actual) {
  if (state.receipt && state.receipt.daemon !== actual.daemon) return false;
  if (state.phase === "ready") return sameRuntime(state.receipt, actual);
  return actual.containers.every(
    (container) =>
      container.generation === state.generation ||
      state.receipt?.containers.some(
        (old) =>
          old.id === container.id &&
          old.image === container.image &&
          old.service === container.service,
      ),
  );
}

/** @param {StandDependencies} dependencies */
async function status(dependencies) {
  const state = await readState(dependencies.directory);
  const snapshot = await dependencies.inspect();
  let availability = "stopped";
  if (snapshot.containers.length > 0) {
    if (!state || !controlledRuntime(state, snapshot))
      availability = "unmanaged";
    else if (state.phase !== "ready") availability = "recovery";
    else {
      try {
        if (!dependencies.ready) throw new Error("Readiness adapter missing");
        const health = await dependencies.ready(snapshot);
        if (state.health && health.schema !== state.health.schema)
          throw new Error("Schema changed");
        availability = "ready";
      } catch {
        availability = "unhealthy";
      }
    }
  }
  return {
    status: availability,
    reservation: state?.reservation ?? null,
    source: state?.source ?? null,
    mode: state?.mode ?? null,
    controller: state?.controller ?? dependencies.controller,
    url: availability === "ready" ? (state?.health?.url ?? null) : null,
  };
}

/** @param {string} directory */
async function readState(directory) {
  try {
    const container = await lstat(directory);
    if (!container.isDirectory() || container.isSymbolicLink())
      throw new Error("Stand state directory must be a real directory");
    const path = join(directory, "state.json");
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error("Stand state must be a regular file");
    return stateSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw new Error("Stand state is invalid; preserve it for recovery", {
      cause: error,
    });
  }
}

/** @param {string} directory @param {StandState} state */
async function writeState(directory, state) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error("Stand state directory must be a real directory");
  const temporary = join(directory, `state-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, join(directory, "state.json"));
}
