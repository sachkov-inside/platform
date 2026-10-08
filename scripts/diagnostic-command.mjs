// @ts-check

/**
 * Observe both command completion and a failure to start. The caller owns stopOwned in finally.
 * @param {import("node:child_process").ChildProcess} child
 * @returns {Promise<number | null>}
 */
export function commandExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("exit", exited);
    child.once("error", failed);
    /** @param {number | null} code */
    function exited(code) {
      child.removeListener("error", failed);
      resolve(code);
    }
    /** @param {Error} error */
    function failed(error) {
      child.removeListener("exit", exited);
      reject(error);
    }
  });
}
