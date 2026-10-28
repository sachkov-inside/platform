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
  // Present from the start of an upgrade until its ready receipt; other preparation waits for it.
  // `backup` stays null until the pre-upgrade dump is complete.
  upgrade: z.strictObject({ backup: z.string().nullable() }).optional(),
});

/**
 * @typedef {z.infer<typeof snapshotSchema>} StandSnapshot
 * @typedef {z.infer<typeof sourceSchema>} StandSource
 * @typedef {z.infer<typeof stateSchema>} StandState
 * @typedef {z.infer<typeof modeSchema>} StandMode
 * @typedef {{ source: StandSource; mode: StandMode; generation: string; cold: boolean; resumeCold: boolean; upgrade?: StandSnapshot; recordIdentity: (expected: string) => Promise<void> }} StandOperation
 * `upgrade` carries the pre-upgrade receipt: infrastructure keeps its labels, so Compose replaces only changed services.
 * @typedef {{ command: "status" | "show" | "refresh" | "release" | "upgrade"; worktree: string; replace?: string; mode?: "snapshot" | "live" | "production" }} StandRequest
 * @typedef {{ directory: string; controller: string; inspect: () => Promise<StandSnapshot>; acquire?: () => Promise<() => Promise<void>>; source?: (root: string) => Promise<StandSource>; baseline?: () => Promise<StandSource>; prepare?: (operation: StandOperation) => Promise<void>; ready?: (snapshot: StandSnapshot) => Promise<{schema: string; url: string}>; backup?: (snapshot: StandSnapshot, generation: string) => Promise<string> }} StandDependencies
 */

/** @param {StandRequest} request @param {StandDependencies} dependencies */
export async function controlStand(request, dependencies) {
  if (
    request.replace !== undefined &&
    request.command !== "show" &&
    request.command !== "upgrade"
  )
    throw new Error("--replace applies to show and upgrade only");
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
    if (request.command === "upgrade")
      return await upgrade(request, source, previous, dependencies);
    if (previous?.upgrade)
      throw new Error(
        `A stand upgrade is incomplete; rerun pnpm stand upgrade for its source (backup: ${previous.upgrade.backup ?? "not taken"})`,
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
        recordIdentity: async (expected) => {
          if (!cold)
            throw new Error(
              "Identity bootstrap checkpoint is restricted to cold startup",
            );
          const bootstrapped = sourceSchema.parse(
            await dependencies.source?.(request.worktree),
          );
          if (bootstrapped.identity !== expected)
            throw new Error(
              "Stand identity no longer matches its owned bootstrap receipt",
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

/**
 * Move a ready managed stand forward to the selected source's schema and infrastructure. A backup
 * precedes every change; migrations only run forward, and seed and identity bootstrap never rerun.
 * @param {StandRequest} request
 * @param {StandSource} source
 * @param {StandState | null} previous
 * @param {StandDependencies} dependencies
 */
async function upgrade(request, source, previous, dependencies) {
  if (
    !dependencies.backup ||
    !dependencies.prepare ||
    !dependencies.ready ||
    !dependencies.source
  )
    throw new Error("Stand upgrade requires the backup and runtime adapters");
  const snapshot = snapshotSchema.parse(await dependencies.inspect());
  if (
    !previous ||
    snapshot.containers.length === 0 ||
    !controlledRuntime(previous, snapshot)
  )
    throw new Error(
      "Upgrade requires a running managed stand; use show for a first start or obtain a handoff",
    );
  if (previous.source.identity !== source.identity)
    throw new Error(
      "Stand identity settings changed outside the controller; preserve the current accounts and obtain a handoff",
    );
  const resume = previous.upgrade;
  if (resume) {
    if (
      previous.source.schema !== source.schema ||
      previous.source.infrastructure !== source.infrastructure
    )
      throw new Error(
        `Finish the incomplete upgrade with its original source first (backup: ${resume.backup ?? "not taken"})`,
      );
  } else {
    if (
      previous.source.schema === source.schema &&
      previous.source.infrastructure === source.infrastructure
    )
      throw new Error(
        "Stand schema and infrastructure already match this source; use show or refresh",
      );
    if (previous.phase !== "ready" || !previous.health)
      throw new Error(
        "The stand must be ready before an upgrade; refresh its current source first",
      );
    let health;
    try {
      health = await dependencies.ready(snapshot);
    } catch {
      throw new Error(
        "The stand must be ready before an upgrade; refresh its current source first",
      );
    }
    if (health.schema !== previous.health.schema)
      throw new Error(
        "The running database schema changed outside the controller",
      );
  }
  const reservation = previous.reservation;
  /** @type {StandState} */
  const state = {
    ...previous,
    phase: "preparing",
    generation: randomUUID(),
    reservation:
      reservation?.worktree === request.worktree
        ? reservation
        : { id: randomUUID(), worktree: request.worktree },
    source,
    mode: request.mode ?? previous.mode,
    // An interrupted upgrade keeps comparing with the stand it started from.
    receipt: resume ? previous.receipt : snapshot,
    upgrade: resume ?? { backup: null },
  };
  const marker = state.upgrade ?? { backup: null };
  await writeState(dependencies.directory, state);
  try {
    // Migrations start only after a complete dump of the stand as it was.
    if (marker.backup === null) {
      marker.backup = await dependencies.backup(snapshot, state.generation);
      await writeState(dependencies.directory, state);
    }
    const before = state.receipt ?? snapshot;
    await dependencies.prepare({
      source,
      mode: state.mode,
      generation: state.generation,
      cold: false,
      resumeCold: false,
      upgrade: before,
      recordIdentity: async () => {
        throw new Error(
          "Identity bootstrap checkpoint is restricted to cold startup",
        );
      },
    });
    const prepared = snapshotSchema.parse(await dependencies.inspect());
    if (
      prepared.daemon !== before.daemon ||
      !upgradedRuntime(before, prepared, state.generation)
    )
      throw new Error(
        "Stand ownership or infrastructure changed during the upgrade",
      );
    const health = await dependencies.ready(prepared);
    const after = sourceSchema.parse(
      await dependencies.source(request.worktree),
    );
    if (
      state.mode === "live"
        ? after.build !== source.build
        : after.fingerprint !== source.fingerprint
    )
      throw new Error(
        "Source changed during the upgrade; rerun upgrade after edits settle",
      );
    state.source = after;
    state.receipt = prepared;
    state.health = health;
    state.phase = "ready";
    delete state.upgrade;
    await writeState(dependencies.directory, state);
  } catch (error) {
    state.phase = "failed";
    await writeState(dependencies.directory, state);
    if (error instanceof Error)
      error.message = `${error.message}; rerun pnpm stand upgrade to resume (backup: ${marker.backup ?? "not taken"})`;
    throw error;
  }
  return status(dependencies);
}

/**
 * Application roles carry the upgrade generation. Infrastructure is unchanged or recreated with
 * the label it had before, which shows it came from this upgrade's Compose configuration.
 * @param {StandSnapshot} before @param {StandSnapshot} after @param {string} generation
 */
function upgradedRuntime(before, after, generation) {
  return (
    after.containers.every((container) => {
      const old = before.containers.find(
        (item) => item.service === container.service,
      );
      if (standApplicationServices.includes(container.service) || !old)
        return container.generation === generation;
      return (
        container.generation === old.generation ||
        before.containers.some((item) => item.id === container.id)
      );
    }) &&
    before.containers.every((old) =>
      after.containers.some((container) => container.service === old.service),
    )
  );
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
  if (state.upgrade && state.receipt)
    return actual.containers.every(
      (container) =>
        container.generation === state.generation ||
        state.receipt?.containers.some(
          (old) =>
            old.service === container.service &&
            (old.id === container.id ||
              (!standApplicationServices.includes(old.service) &&
                old.generation === container.generation)),
        ),
    );
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
