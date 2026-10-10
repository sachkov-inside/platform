// @ts-check
import { isAbsolute } from "node:path";
const gib = 1024 ** 3;
const hostReserveBytes = 10 * gib;
// Cached stand estimate:3 GiB for source/web/export plus two <=2.261 GB dependency snapshots if
// cache keys miss, rounded up to8 GiB. Bounded runtime proof must validate actual growth. Shared
// cache records overlap; their sum is not physical storage. Never prune another session's data.
// Measurement period:2026-10-09 UTC /2026-10-10 MSK. Source/model:docs/evidence/issue-1304/README.md.
// Refreshed main391/#1318 inputs:docs/evidence/issue-1304/resume-1318/README.md; actual peak pending.
const buildAllowanceBytes = 8 * gib;
const stopMarginBytes = 256 * 1024 ** 2;
// Coordinator's bounded-proof admission keeps2 GiB of stop/cleanup headroom above ceiling+floor.
const minimumStartingFreeBytes = 20 * gib;

/** @param {string} openFiles lsof file metadata, never file contents */
export function dockerDesktopStoragePath(openFiles) {
  const disks = [
    ...new Set(
      openFiles
        .split("\n")
        .filter((line) => line.startsWith("n") && line.endsWith("/Docker.raw"))
        .map((line) => line.slice(1)),
    ),
  ];
  const [disk] = disks;
  if (disks.length !== 1 || disk === undefined || !isAbsolute(disk)) {
    throw new Error(
      "Cannot identify the active Docker Desktop data disk; refusing an unmeasured build budget.",
    );
  }
  return disk;
}

/**
 * @param {() => number} freeBytes measured available bytes on the Docker Desktop host filesystem
 */
export function createStandBuildBudget(freeBytes) {
  const initialFreeBytes = freeBytes();
  if (initialFreeBytes < minimumStartingFreeBytes) {
    throw new Error(
      `Local stand needs ${minimumStartingFreeBytes / gib} GiB available before building (${buildAllowanceBytes / gib} GiB build ceiling and ${hostReserveBytes / gib} GiB host floor); measured ${(initialFreeBytes / gib).toFixed(2)} GiB. Keep stand data and arrange disk capacity before retrying.`,
    );
  }
  return {
    initialFreeBytes,
    assertAvailable() {
      const available = freeBytes();
      if (available <= hostReserveBytes + stopMarginBytes) {
        throw new Error(
          `Local stand stopped with ${stopMarginBytes / 1024 ** 2} MiB stop margin to preserve its ${hostReserveBytes / gib} GiB host floor.`,
        );
      }
      if (
        initialFreeBytes - available >=
        buildAllowanceBytes - stopMarginBytes
      ) {
        throw new Error(
          `Local stand stopped with ${stopMarginBytes / 1024 ** 2} MiB stop margin before its ${buildAllowanceBytes / gib} GiB build ceiling.`,
        );
      }
    },
  };
}
