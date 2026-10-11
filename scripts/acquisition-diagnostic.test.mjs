// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  observePull,
  observeAuth,
  safePullEvent,
  runSetupAndTeardown,
} from "./acquisition-diagnostic.mjs";

test("observation preserves the original promise, arguments and rejection identity", async () => {
  const error = new Error("secret-token https://host/path?signature=secret");
  const promise = Promise.reject(error);
  const image = { string: "image" };
  const options = { force: false, platform: undefined };
  /** @type {{event: string, [key: string]: unknown}[]} */
  const records = [];
  const client = {
    /** @param {...unknown} args */
    pull(...args) {
      assert.equal(this, client);
      assert.deepEqual(args, [image, options]);
      return promise;
    },
  };
  const restore = observePull(client, (record) => records.push(record));
  try {
    assert.equal(client.pull(image, options), promise);
    await assert.rejects(promise, (actual) => actual === error);
    assert.deepEqual(
      records.map((record) => record.event),
      ["pull-start", "pull-failed"],
    );
    assert.doesNotMatch(JSON.stringify(records), /secret|signature|https/);
  } finally {
    restore();
  }
});

test("auth observation forwards lookup and omits auth values", async () => {
  const auth = {
    username: "AWS",
    password: "DO-NOT-LOG",
    identitytoken: "TOKEN",
  };
  const promise = Promise.resolve(auth);
  /** @type {{event: string, [key: string]: unknown}[]} */
  const records = [];
  const lookup = {
    /** @param {string} registry */
    getAuthConfig(registry) {
      assert.equal(registry, "public.ecr.aws");
      return promise;
    },
  };
  const restore = observeAuth(lookup, (record) => records.push(record));
  try {
    assert.equal(lookup.getAuthConfig("public.ecr.aws"), promise);
    assert.equal(await promise, auth);
    assert.deepEqual(records, [
      { event: "auth-resolved", registry: "public.ecr.aws", present: true },
    ]);
    assert.doesNotMatch(
      JSON.stringify(records),
      /DO-NOT-LOG|TOKEN|password|username/,
    );
  } finally {
    restore();
  }
});

test("pull diagnostics retain the rate signal but omit arbitrary URLs, headers and tokens", () => {
  assert.deepEqual(
    safePullEvent({
      status: "Downloading",
      headers: { Authorization: "TOKEN" },
      url: "https://host/?signature=SECRET",
      progress: "secret",
    }),
    { status: "Downloading" },
  );
  assert.deepEqual(
    safePullEvent({
      errorDetail: { message: "toomanyrequests: Rate exceeded" },
    }),
    { status: "omitted", error: "toomanyrequests: Rate exceeded" },
  );
  assert.deepEqual(
    safePullEvent({
      status: "https://host/?token=SECRET",
      error: "Authorization: SECRET",
    }),
    { status: "omitted", error: "omitted" },
  );
});

test("normal teardown runs after successful setup and after observation failure", async () => {
  /** @type {string[]} */
  const calls = [];
  const setup = async () => {
    calls.push("setup");
    return async () => {
      calls.push("teardown");
    };
  };
  const failure = new Error("observation failed");
  await assert.rejects(
    runSetupAndTeardown(setup, () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(calls, ["setup", "teardown"]);
});
