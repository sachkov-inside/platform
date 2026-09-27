// @ts-check
// Allowed: the callback runs after the module has loaded, as node:test runs test().
setTimeout(() => {
  assertReady("ready");
}, 0);

const readyStatus = "ready";

/** @param {string} status */
function assertReady(status) {
  if (status !== readyStatus) throw new Error("not ready");
}

// Allowed: an export names a function without running it.
export { assertReady };
