// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixture.mjs";
test("fixture connect cleanup keeps its actual first private failure", async () => {
  const primary = new Error("controlled connect"),
    secondary = new Error("controlled end");
  const owner = fixture(() => ({
    connect: async () => {
      throw primary;
    },
    query: async () => {
      throw new Error("unexpected query");
    },
    end: async () => {
      throw secondary;
    },
  }));
  await assert.rejects(owner.act("setup", 1000), (error) => error === primary);
});
test("ordinary source module imports and explicit invalid fixture commands allocate no clients", async () => {
  let clients = 0;
  const owner = fixture(() => {
    clients += 1;
    throw new Error("controlled allocation");
  });
  assert.equal(clients, 0);
  await assert.rejects(owner.act("arbitrary SQL", 1000));
  assert.equal(clients, 0);
});
