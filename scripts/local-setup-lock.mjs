// @ts-check
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import lockfile from "proper-lockfile";

/**
 * Local setup, the stand and the identity proofs own the same Compose project, ports and
 * PostgreSQL volume, so one machine-wide lock serialises them.
 */
const localSetupLockTarget = resolve(tmpdir(), "inside-platform-local-setup");

/**
 * Takes the machine-wide lock or fails at once when another session holds it.
 *
 * @param {string} busyMessage what the owner reads when another session holds the lock
 * @param {string} [lockTarget] only tests pass their own target
 * @returns {Promise<() => Promise<void>>} release of the lock
 */
export async function acquireLocalSetupLock(
  busyMessage,
  lockTarget = localSetupLockTarget,
) {
  try {
    return await lockfile.lock(lockTarget, {
      realpath: false,
      retries: 0,
      stale: 30_000,
      update: 10_000,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
      throw new Error(busyMessage, { cause: error });
    }
    throw error;
  }
}
