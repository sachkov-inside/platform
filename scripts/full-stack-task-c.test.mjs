// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { seedFullStackTaskC } from "./full-stack-task-c.mjs";

test("the current full-stack Task package passes preflight before contacting the receiver", async (t) => {
  const boundary = new Error("Receiver boundary reached");
  /** @type {typeof fetch} */
  const receiver = async (input, init) => {
    assert.equal(
      input,
      "http://localhost:19999/authoring/import/materials/environment",
    );
    assert.equal(init?.method, "GET");
    throw boundary;
  };
  t.mock.method(globalThis, "fetch", receiver);

  await assert.rejects(
    seedFullStackTaskC("http://localhost:19999", "synthetic-never-sent"),
    (error) => error === boundary,
  );
});
