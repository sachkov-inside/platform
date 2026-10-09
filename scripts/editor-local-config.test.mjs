// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  editorLocalPorts,
  editorLocalEndpoints,
  assertEditorPortsAvailable,
} from "./editor-local-config.mjs";

const execute = promisify(execFile);

test("editor ports retain defaults and accept distinct environment overrides", () => {
  assert.deepEqual(editorLocalPorts({}), {
    gateway: 4396,
    api: 4397,
    web: 4398,
  });
  assert.deepEqual(
    editorLocalPorts({
      EDITOR_LOCAL_GATEWAY_PORT: "4496",
      EDITOR_LOCAL_API_PORT: "4497",
      EDITOR_LOCAL_WEB_PORT: "4498",
    }),
    { gateway: 4496, api: 4497, web: 4498 },
  );
  for (const value of ["", "abc", "0", "65536", "4396.5"]) {
    assert.throws(
      () => editorLocalPorts({ EDITOR_LOCAL_GATEWAY_PORT: value }),
      /EDITOR_LOCAL_GATEWAY_PORT/u,
    );
  }
  assert.throws(
    () => editorLocalPorts({ EDITOR_LOCAL_WEB_PORT: "4396" }),
    /distinct/u,
  );
});

// Loopback/process adapter contract: hold an owned port and prove refusal before any runtime setup.
test("occupied editor port refuses launcher before identity or subprocess startup", async (t) => {
  const server = createServer();
  t.after(
    () =>
      new Promise((done, reject) =>
        server.close((error) => (error ? reject(error) : done(undefined))),
      ),
  );
  await new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done(undefined)),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const ports = { gateway: address.port, api: 4397, web: 4398 };
  await assert.rejects(
    assertEditorPortsAvailable(ports),
    /EDITOR_LOCAL_GATEWAY_PORT.*already in use/u,
  );
  await assert.rejects(
    execute(process.execPath, [resolve("scripts/editor-local-review.mjs")], {
      env: {
        ...process.env,
        npm_execpath: "/not-a-pnpm-executable",
        EDITOR_LOCAL_GATEWAY_PORT: String(address.port),
      },
      timeout: 10_000,
    }),
    (error) => {
      assert.ok(error instanceof Error && "stderr" in error);
      assert.match(
        String(error.stderr),
        /EDITOR_LOCAL_GATEWAY_PORT.*already in use/u,
      );
      assert.doesNotMatch(
        String(error.stderr),
        /not-a-pnpm-executable|Local setup failed/u,
      );
      return true;
    },
  );
  assert.equal(server.listening, true);
});

test("editor origins and forwarded hosts use browser normalization, including HTTP port 80", () => {
  assert.deepEqual(
    editorLocalEndpoints({ gateway: 4496, api: 4497, web: 4498 }),
    {
      gatewayHost: "127.0.0.1:4496",
      apiHost: "127.0.0.1:4497",
      webBaseUrl: "http://127.0.0.1:4496",
      apiBaseUrl: "http://127.0.0.1:4497",
    },
  );
  assert.deepEqual(
    editorLocalEndpoints({ gateway: 80, api: 4497, web: 4498 }),
    {
      gatewayHost: "127.0.0.1",
      apiHost: "127.0.0.1:4497",
      webBaseUrl: "http://127.0.0.1",
      apiBaseUrl: "http://127.0.0.1:4497",
    },
  );
  assert.equal(
    editorLocalEndpoints({ gateway: 4496, api: 80, web: 4498 }).apiHost,
    "127.0.0.1",
  );
});
