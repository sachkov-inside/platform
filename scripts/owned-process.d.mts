import type { ChildProcess, SpawnOptions } from "node:child_process";

export function spawnOwned(
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
): ChildProcess;
export function isOwnedProcess(child: ChildProcess): boolean;
export function stopOwned(
  child: ChildProcess,
  graceMilliseconds?: number,
): Promise<void>;
