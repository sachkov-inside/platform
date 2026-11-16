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
const identityChanged =
  "Stand identity settings changed outside the controller; preserve the current accounts and obtain a handoff";
const upgradeNeedsReady =
  "The stand must be ready before an upgrade; refresh its current source first";
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
 * `upgrade` carries the pre-upgrade receipt: infrastructure keeps its labels, so Compose replaces services whose configuration changed.
 * @typedef {{ command: "status" | "show" | "refresh" | "release" | "upgrade"; worktree: string; replace?: string; ifOwned?: boolean; mode?: "snapshot" | "live" | "production" }} StandRequest
 * `ifOwned` makes `release` leave another worktree's reservation in place instead of refusing.
 * @typedef {{ directory: string; controller: string; inspect: () => Promise<StandSnapshot>; acquire?: () => Promise<() => Promise<void>>; source?: (root: string) => Promise<StandSource>; baseline?: () => Promise<StandSource>; prepare?: (operation: StandOperation) => Promise<void>; now?: () => Date; worktreeExists?: (path: string) => Promise<boolean>; ready?: (snapshot: StandSnapshot) => Promise<{schema: string; url: string}>; backup?: (snapshot: StandSnapshot, generation: string) => Promise<string> }} StandDependencies
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
  const now = dependencies.now ?? (() => new Date());
  const reserve = async () => {
    const reservation = { id: randomUUID(), worktree: request.worktree };
    await recordReservationTime(dependencies.directory, reservation.id, now());
    return reservation;
  };
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
    const recorded = previous?.reservation;
    if (request.replace !== undefined && request.replace !== recorded?.id)
      throw new Error(
        "The reservation changed; read stand status before replacing it",
      );
    let reservation = recorded;
    /** @type {{ id: string; worktree: string } | undefined} */
    let releasedStale;
    // A reservation outlives its session by design, but not its worktree: nobody can review it.
    if (previous && recorded && (await orphaned(recorded, dependencies))) {
      releasedStale = { id: recorded.id, worktree: recorded.worktree };
      reservation = null;
      previous.reservation = null;
      await writeState(dependencies.directory, previous);
    }
    if (
      request.command === "release" &&
      request.ifOwned &&
      reservation &&
      reservation.worktree !== request.worktree
    )
      return status(dependencies, releasedStale);
    refuseForeignReservation(request, reservation);
    if (request.command === "release") {
      if (previous) {
        previous.reservation = null;
        await writeState(dependencies.directory, previous);
      }
      return status(dependencies, releasedStale);
    }
    const source = sourceSchema.parse(
      await dependencies.source(request.worktree),
    );
    if (request.command === "upgrade")
      return await upgrade(
        request,
        source,
        previous,
        dependencies,
        reserve,
        releasedStale,
      );
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
    refuseIncompatibleSource(previous, source);
    const snapshot = snapshotSchema.parse(await dependencies.inspect());
    if (
      snapshot.containers.length > 0 &&
      (!previous || !controlledRuntime(previous, snapshot))
    )
      throw new Error(
        "Stand is unmanaged or its containers changed ownership; obtain an owner handoff before changing it",
      );
    const mode = selectedMode(request, previous, source.root);
    const sameSource = runsSource(previous, source, mode);
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
      sameSource &&
      sameRuntime(previous.receipt, snapshot)
    ) {
      await dependencies.ready(snapshot);
      previous.reservation = reservation ?? (await reserve());
      previous.source = source;
      await writeState(dependencies.directory, previous);
      return status(dependencies, releasedStale);
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
          : await reserve(),
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
    return status(dependencies, releasedStale);
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
 * @param {() => Promise<NonNullable<StandState["reservation"]>>} reserve
 * @param {{ id: string; worktree: string } | undefined} releasedStale
 */
async function upgrade(
  request,
  source,
  previous,
  dependencies,
  reserve,
  releasedStale,
) {
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
    throw new Error(identityChanged);
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
    const health =
      previous.phase === "ready" && previous.health
        ? await dependencies.ready(snapshot).catch(() => undefined)
        : undefined;
    if (!health || !previous.health) throw new Error(upgradeNeedsReady);
    if (health.schema !== previous.health.schema)
      throw new Error(
        "The running database schema changed outside the controller",
      );
  }
  const reservation = previous.reservation;
  // An interrupted upgrade keeps comparing with the stand it started from.
  const before = (resume && previous.receipt) || snapshot;
  /** @type {StandState} */
  const state = {
    ...previous,
    phase: "preparing",
    generation: randomUUID(),
    reservation:
      reservation?.worktree === request.worktree
        ? reservation
        : await reserve(),
    source,
    mode: request.mode ?? previous.mode,
    receipt: before,
  };
  const marker = resume ?? { backup: null };
  state.upgrade = marker;
  await writeState(dependencies.directory, state);
  try {
    // Migrations start only after a complete dump of the stand as it was.
    if (marker.backup === null) {
      marker.backup = await dependencies.backup(snapshot, state.generation);
      await writeState(dependencies.directory, state);
    }
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
  return status(dependencies, releasedStale);
}

/**
 * Application roles carry the upgrade generation. Infrastructure is unchanged or recreated with
 * the label it had before, as the upgrade's Compose configuration retains it; every service the
 * stand had before is still present.
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

/**
 * @param {StandRequest} request
 * @param {StandState["reservation"] | undefined} reservation
 */
function refuseForeignReservation(request, reservation) {
  if (
    reservation &&
    reservation.worktree !== request.worktree &&
    request.replace !== reservation.id
  )
    throw new Error(
      `Stand is reserved for ${reservation.worktree} (${reservation.id})`,
    );
}

/**
 * Whether the reserved worktree no longer exists. Without the check adapter nothing is orphaned.
 * @param {NonNullable<StandState["reservation"]>} reservation
 * @param {Pick<StandDependencies, "worktreeExists">} dependencies
 */
async function orphaned(reservation, dependencies) {
  return dependencies.worktreeExists
    ? !(await dependencies.worktreeExists(reservation.worktree))
    : false;
}

/**
 * `show` and `refresh` keep the recorded identity, schema and infrastructure; `upgrade` changes them.
 * @param {StandState | null} previous @param {StandSource} source
 */
function refuseIncompatibleSource(previous, source) {
  if (previous && previous.source.identity !== source.identity)
    throw new Error(identityChanged);
  if (
    previous &&
    (previous.source.schema !== source.schema ||
      previous.source.infrastructure !== source.infrastructure)
  )
    throw new Error(
      "Stand schema or infrastructure differs; keep the current stand and prepare a separate migration or infrastructure handoff",
    );
}

/**
 * Whether the recorded stand already runs this source in this mode. Live mode mounts Web sources,
 * so only the build inputs must match.
 * @param {StandState | null} previous @param {StandSource} source @param {StandMode} mode
 */
function runsSource(previous, source, mode) {
  return (
    previous?.source.root === source.root &&
    previous.mode === mode &&
    (mode === "live"
      ? previous.source.build === source.build
      : previous.source.fingerprint === source.fingerprint)
  );
}

/**
 * The preview mode a mutation prepares: the requested one, or the current one for `refresh` of
 * the same worktree and for `upgrade`.
 * @param {StandRequest} request @param {StandState | null} previous @param {string} root
 * @returns {StandMode}
 */
function selectedMode(request, previous, root) {
  return (
    request.mode ??
    (request.command === "refresh" && previous?.source.root === root
      ? previous.mode
      : request.command === "upgrade" && previous
        ? previous.mode
        : "snapshot")
  );
}

/**
 * Decides, without the lock, whether a mutation should build images before it waits for the stand.
 * It refuses what the controller would refuse for a foreign reservation or an incompatible source,
 * and returns null when the ready stand already runs this source in this mode. The controller
 * decides again under the lock; a different answer costs only a build the cache did not cover.
 * @param {StandRequest} request
 * @param {Pick<StandDependencies, "directory" | "worktreeExists">} dependencies
 * @param {StandSource} source
 * @returns {Promise<StandMode | null>} the mode to build for, or null
 */
export async function planPrebuild(request, dependencies, source) {
  const previous = await readState(dependencies.directory);
  const reservation = previous?.reservation;
  if (!reservation || !(await orphaned(reservation, dependencies)))
    refuseForeignReservation(request, reservation);
  if (request.command === "upgrade")
    return selectedMode(request, previous, source.root);
  refuseIncompatibleSource(previous, source);
  const mode = selectedMode(request, previous, source.root);
  return previous?.phase === "ready" && runsSource(previous, source, mode)
    ? null
    : mode;
}

/**
 * The current reservation and the registered controller, read without the lock. `release
 * --if-owned` uses it to leave a foreign reservation alone without touching Docker.
 * @param {string} directory
 */
export async function readReservation(directory) {
  const state = await readState(directory);
  return state
    ? { reservation: state.reservation, controller: state.controller }
    : null;
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

/**
 * @param {StandDependencies} dependencies
 * @param {{ id: string; worktree: string }} [releasedStale] the reservation this operation released
 *   because its worktree no longer exists
 */
async function status(dependencies, releasedStale) {
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
  const reservation = state?.reservation;
  const reservedAt = reservation
    ? (await readReservationTimes(dependencies.directory))[reservation.id]
    : undefined;
  const now = dependencies.now ?? (() => new Date());
  return {
    status: availability,
    reservation: reservation
      ? {
          ...reservation,
          reservedAt: reservedAt ?? null,
          ageSeconds:
            reservedAt === undefined
              ? null
              : Math.max(
                  0,
                  Math.floor(
                    (now().getTime() - Date.parse(reservedAt)) / 1_000,
                  ),
                ),
          worktreeMissing: await orphaned(reservation, dependencies),
        }
      : null,
    ...(releasedStale ? { releasedStale } : {}),
    source: state?.source ?? null,
    mode: state?.mode ?? null,
    controller: state?.controller ?? dependencies.controller,
    url: availability === "ready" ? (state?.health?.url ?? null) : null,
  };
}

// Reservation times live beside state.json, so state keeps the shape older controllers parse.
const reservationTimesSchema = z.record(z.uuid(), z.iso.datetime());

/** @param {string} directory @returns {Promise<Record<string, string>>} */
async function readReservationTimes(directory) {
  try {
    return reservationTimesSchema.parse(
      JSON.parse(
        await readFile(join(directory, "reservation-times.json"), "utf8"),
      ),
    );
  } catch {
    // Missing or damaged times only hide the age; they never block the stand.
    return {};
  }
}

/**
 * Records when a reservation was taken. Only the newest reservation is kept: earlier ones are
 * released or replaced by then.
 * @param {string} directory @param {string} id @param {Date} time
 */
async function recordReservationTime(directory, id, time) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `reservation-times-${randomUUID()}.tmp`);
  await writeFile(
    temporary,
    `${JSON.stringify({ [id]: time.toISOString() })}\n`,
    { mode: 0o600, flag: "wx" },
  );
  await rename(temporary, join(directory, "reservation-times.json"));
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
