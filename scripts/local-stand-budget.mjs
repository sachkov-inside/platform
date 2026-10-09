// @ts-check
const gib = 1024 ** 3;
const hostReserveBytes = 15 * gib;
// One backend export plus web, Logto and RabbitMQ. Runtime proof measures this bound; never prune
// another session's data to obtain it. The monitor also catches unexpected growth after preflight.
const buildAllowanceBytes = 10 * gib;

/**
 * @param {() => number} freeBytes measured available bytes on the Docker Desktop host filesystem
 */
export function createStandBuildBudget(freeBytes) {
  const initialFreeBytes = freeBytes();
  if (initialFreeBytes < hostReserveBytes + buildAllowanceBytes) {
    throw new Error(
      `Local stand needs 25 GiB available before building (10 GiB build allowance and 15 GiB host reserve); measured ${(initialFreeBytes / gib).toFixed(2)} GiB. Keep stand data and arrange disk capacity before retrying.`,
    );
  }
  return {
    assertAvailable() {
      const available = freeBytes();
      if (available < hostReserveBytes) {
        throw new Error(
          "Local stand stopped to preserve its 15 GiB host reserve.",
        );
      }
      if (initialFreeBytes - available > buildAllowanceBytes) {
        throw new Error(
          "Local stand stopped after consuming its 10 GiB build allowance.",
        );
      }
    },
  };
}
