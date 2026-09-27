// @ts-check
// Reproduces #774: code at the top level calls a function that reads a value declared later.
try {
  assertHealth({ status: "ready" });
} finally {
  process.stdout.write("done\n");
}

const healthStatuses = new Set(["ready"]);

/** @param {{ status: string }} value */
function assertHealth(value) {
  if (!healthStatuses.has(value.status)) throw new Error("not ready");
}
