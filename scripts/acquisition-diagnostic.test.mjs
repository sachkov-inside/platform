// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  observePull,
  observeAuth,
  observeExists,
  observeRequest,
  acquireSelectedImage,
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
  let clock = 0;
  const restore = observeAuth(
    lookup,
    (record) => records.push(record),
    () => clock++,
  );
  try {
    assert.equal(lookup.getAuthConfig("public.ecr.aws"), promise);
    assert.equal(await promise, auth);
    assert.deepEqual(records, [
      {
        event: "auth-start",
        registry: "public.ecr.aws",
        call: 1,
        activeLogicalCalls: 1,
        monotonicMs: 0,
      },
      {
        event: "auth-resolved",
        registry: "public.ecr.aws",
        present: true,
        call: 1,
        activeLogicalCalls: 0,
        monotonicMs: 1,
        elapsedMs: 1,
      },
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

test("normal SDK pull receipt identifies overlapping calls and their actual settlement", async () => {
  const image = { string: "image" };
  const options = { force: false, platform: undefined };
  const first = Promise.resolve("first");
  const error = new Error("TOKEN must not enter receipt");
  const second = Promise.reject(error);
  const supplied = [first, second];
  let clock = 100;
  /** @type {{event: string, [key: string]: unknown}[]} */
  const records = [];
  const client = {
    /** @param {...unknown} args */
    pull(...args) {
      assert.equal(this, client);
      assert.deepEqual(args, [image, options]);
      const promise = supplied.shift();
      assert.ok(promise);
      return promise;
    },
  };
  const original = client.pull;
  const restore = observePull(
    client,
    (row) => records.push(row),
    () => clock++,
  );
  try {
    assert.equal(client.pull(image, options), first);
    assert.equal(client.pull(image, options), second);
    await first;
    await assert.rejects(second, (actual) => actual === error);
    assert.deepEqual(
      records.map((row) => row.activeLogicalCalls),
      [1, 2, 1, 0],
    );
    assert.deepEqual(
      records.map((row) => row.call),
      [1, 2, 1, 2],
    );
    assert.deepEqual(
      records.map((row) => row.monotonicMs),
      [100, 101, 102, 103],
    );
    assert.doesNotMatch(JSON.stringify(records), /TOKEN/);
  } finally {
    restore();
  }
  assert.equal(client.pull, original);
});

test("normal SDK auth receipt distinguishes absent auth and records lookup timeline", async () => {
  const promise = Promise.resolve(undefined);
  let clock = 200;
  /** @type {{event: string, [key: string]: unknown}[]} */
  const records = [];
  const lookup = {
    /** @param {string} registry */
    getAuthConfig(registry) {
      assert.equal(this, lookup);
      assert.equal(registry, "public.ecr.aws");
      return promise;
    },
  };
  const restore = observeAuth(
    lookup,
    (row) => records.push(row),
    () => clock++,
  );
  try {
    assert.equal(lookup.getAuthConfig("public.ecr.aws"), promise);
    assert.equal(await promise, undefined);
    assert.deepEqual(
      records.map((row) => row.event),
      ["auth-start", "auth-resolved"],
    );
    assert.deepEqual(
      records.map((row) => row.monotonicMs),
      [200, 201],
    );
    assert.equal(records[1]?.present, false);
  } finally {
    restore();
  }
});

test("normal SDK cache observation forwards hits and misses without another inspection", async () => {
  const image = { string: "image" };
  const supplied = [Promise.resolve(false), Promise.resolve(true)];
  let calls = 0;
  let clock = 300;
  /** @type {{event: string, [key: string]: unknown}[]} */
  const records = [];
  const client = {
    /** @param {{string: string}} actual */
    exists(actual) {
      assert.equal(this, client);
      assert.equal(actual, image);
      const promise = supplied[calls++];
      assert.ok(promise);
      return promise;
    },
  };
  const original = client.exists;
  const restore = observeExists(
    client,
    (row) => records.push(row),
    () => clock++,
  );
  try {
    for (const promise of supplied) {
      assert.equal(client.exists(image), promise);
      await promise;
    }
    assert.equal(calls, 2);
    assert.deepEqual(
      records
        .filter((row) => row.event === "exists-result")
        .map((row) => row.exists),
      [false, true],
    );
    assert.deepEqual(
      records.map((row) => row.monotonicMs),
      [300, 301, 302, 303],
    );
  } finally {
    restore();
  }
  assert.equal(client.exists, original);
});

test("normal SDK Engine request observation preserves auth arguments and failed promise", async () => {
  const image = "image";
  const credential = { password: "DO-NOT-LOG", identitytoken: "TOKEN" };
  const absent = { authconfig: undefined, platform: undefined };
  const present = { authconfig: credential, platform: "linux/amd64" };
  const stream = { secret: "STREAM-TOKEN" };
  const first = Promise.resolve(stream);
  const error = new Error("SECRET https://signed-url");
  const second = Promise.reject(error);
  const supplied = [first, second];
  const options = [absent, present];
  let calls = 0;
  let clock = 400;
  /** @type {{event: string, [key: string]: unknown}[]} */
  const records = [];
  const transport = {
    /** @param {string} actualImage @param {{authconfig?: unknown, platform?: unknown}} [actualOptions] */
    pull(actualImage, actualOptions) {
      assert.equal(this, transport);
      assert.equal(actualImage, image);
      assert.equal(actualOptions, options[calls]);
      const promise = supplied[calls++];
      assert.ok(promise);
      return promise;
    },
  };
  const original = transport.pull;
  const restore = observeRequest(
    transport,
    (row) => records.push(row),
    () => clock++,
  );
  try {
    assert.equal(transport.pull(image, absent), first);
    assert.equal(transport.pull(image, present), second);
    assert.equal(await first, stream);
    await assert.rejects(second, (actual) => actual === error);
    assert.equal(calls, 2);
    assert.deepEqual(
      records
        .filter((row) => row.event === "request-start")
        .map((row) => row.authConfigPresent),
      [false, true],
    );
    assert.deepEqual(
      records.map((row) => row.activeLogicalCalls),
      [1, 2, 1, 0],
    );
    assert.deepEqual(
      records.map((row) => row.monotonicMs),
      [400, 401, 402, 403],
    );
    assert.doesNotMatch(
      JSON.stringify(records),
      /TOKEN|SECRET|DO-NOT-LOG|signed-url|password/,
    );
  } finally {
    restore();
  }
  assert.equal(transport.pull, original);
});

test("normal SDK selection acquires pinned RabbitMQ once and rejects other targets", async () => {
  const image = {
    string:
      "public.ecr.aws/docker/library/rabbitmq:4.2.4-management-alpine@sha256:adac51a4a14a200b8eb928a12787564ed56e93fc55e789a73ec13e1e2eac7aef",
  };
  const error = new Error("toomanyrequests: Rate exceeded");
  const promise = Promise.reject(error);
  let calls = 0;
  /** @type {{event: string, [key: string]: unknown}[]} */
  const records = [];
  const client = {
    /** @param {{string: string}} actualImage @param {{force: boolean, platform: undefined}} actualOptions */
    pull(actualImage, actualOptions) {
      assert.equal(this, client);
      assert.equal(actualImage, image);
      assert.deepEqual(actualOptions, { force: false, platform: undefined });
      calls++;
      return promise;
    },
  };
  for (const selection of [undefined, "postgres", "TOKEN", 1]) {
    assert.throws(() =>
      acquireSelectedImage(client, image, selection, (row) =>
        records.push(row),
      ),
    );
  }
  assert.throws(() =>
    acquireSelectedImage(
      client,
      { string: "public.ecr.aws/docker/library/rabbitmq:latest" },
      "rabbitmq",
      (row) => records.push(row),
    ),
  );
  assert.equal(calls, 0);
  assert.equal(
    acquireSelectedImage(client, image, "rabbitmq", (row) => records.push(row)),
    promise,
  );
  await assert.rejects(promise, (actual) => actual === error);
  assert.equal(calls, 1);
  assert.deepEqual(records, [
    {
      event: "selected-image",
      image: image.string,
      selection: "rabbitmq",
      logicalCallsMaximum: 1,
    },
  ]);
});
