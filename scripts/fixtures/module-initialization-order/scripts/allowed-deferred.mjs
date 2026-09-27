// @ts-check
// Allowed: exports name a function without running it, even before the value it reads.
export { assertReady };
export default assertReady;

// Allowed: the callback runs after the module has loaded, as node:test runs test().
setTimeout(() => {
  assertReady("ready");
}, 0);

const readyStatus = "ready";

/** @param {string} status */
function assertReady(status) {
  if (status !== readyStatus) throw new Error("not ready");
}
