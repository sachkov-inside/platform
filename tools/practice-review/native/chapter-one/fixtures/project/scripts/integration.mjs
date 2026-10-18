import assert from "node:assert/strict";
const response = await fetch(
  new URL("/health", process.env.BACKEND_URL ?? "http://backend:8081"),
);
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), {
  status: "ready",
  database: "connected",
});
