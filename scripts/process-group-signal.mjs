// @ts-check
import process from "node:process";

/**
 * @param {number} pid
 * @param {NodeJS.Signals | number} signal
 * @param {(pid: number, signal?: NodeJS.Signals | number) => unknown} [kill]
 * @returns {boolean}
 */
export function signalProcessGroup(pid, signal, kill = process.kill) {
  try {
    kill(-pid, signal);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "ESRCH")
    ) {
      return false;
    }
    throw error;
  }
}
