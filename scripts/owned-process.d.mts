import type { ChildProcess, SpawnOptions } from "node:child_process";

export type OwnedSpawnOptions = SpawnOptions & {
  /** EOF/parent-death fallback only; finite 0..5000 ms, default 5000. */
  ownerExitGraceMilliseconds?: number;
};

export function spawnOwned(
  command: string,
  args?: readonly string[],
  options?: OwnedSpawnOptions,
): ChildProcess;
export function isOwnedProcess(child: ChildProcess): boolean;
export function stopOwned(
  child: ChildProcess,
  graceMilliseconds?: number,
): Promise<void>;
