import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical } from "./package.mjs";
import { reviewOrigin } from "./local-sync.mjs";
import { transferRequired, uploadVideo } from "./video.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const videoId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sourceId = "inside-content:lesson";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-video-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "state");
  await mkdir(state);
  const file = join(directory, "final.mp4");
  await writeFile(file, "recording-bytes");
  const journal = {
    schemaVersion: 1,
    target: reviewOrigin,
    materials: {
      [sourceId]: {
        materialId,
        contentVersion: 2,
        digest: "a".repeat(64),
        access: "membership",
      },
    },
    guides: {},
    operations: {},
  };
  await writeFile(join(state, "journal.json"), canonical(journal));
  return {
    state,
    file,
    read: async () =>
      JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  };
}

function providerApi({
  endpoint = "https://uploads.invalid/provider-one",
  loseFirstInit = false,
} = {}) {
  const calls = [];
  const attempts = new Map();
  let lose = loseFirstInit;
  let reconciles = 0;
  return {
    calls,
    async request(path, body, key) {
      calls.push({ path, key });
      if (path === "/authoring/import/materials/environment")
        return { mode: "development" };
      if (path === `/authoring/materials/${materialId}/videos/uploads`) {
        assert.ok(key?.startsWith("video-upload:"));
        assert.deepEqual(body, {
          access: "membership",
          byteSize: 15,
          filename: "final.mp4",
          title: "Финальная запись",
        });
        if (!attempts.has(key))
          attempts.set(key, {
            providerVideoId: "provider-one",
            uploadEndpoint: endpoint,
            video: { videoId, materialId, state: "uploading" },
          });
        if (lose) {
          lose = false;
          throw new Error("Connection lost after the attempt was stored");
        }
        return structuredClone(attempts.get(key));
      }
      if (path === `/authoring/videos/${videoId}/reconcile`)
        return {
          videoId,
          materialId,
          state: ++reconciles >= 2 ? "ready" : "processing",
          durationSeconds: 600,
        };
      throw new Error(`Unexpected API request: ${path}`);
    },
    attempts,
  };
}

const upload = (setup, api, extra = {}) =>
  uploadVideo({
    stateDirectory: setup.state,
    sourceId,
    file: setup.file,
    title: "Финальная запись",
    request: api.request,
    sleep: async () => {},
    ...extra,
  });

test("a lost init response retries the persisted key and reaches a ready video once", async (t) => {
  const setup = await fixture(t);
  const api = providerApi({ loseFirstInit: true });
  await assert.rejects(upload(setup, api), /Connection lost/u);
  const pending = Object.values((await setup.read()).resources)[0];
  assert.equal(pending.phase, "initializing");
  const result = await upload(setup, api);
  assert.deepEqual(result, {
    sourceId,
    materialId,
    videoId,
    providerVideoId: "provider-one",
    durationSeconds: 600,
  });
  const keys = api.calls
    .filter((call) => call.path.endsWith("/uploads"))
    .map((call) => call.key);
  assert.equal(new Set(keys).size, 1);
  assert.equal(api.attempts.size, 1);
  const journal = await setup.read();
  assert.deepEqual(
    journal.resources[`source-video:${sourceId}`].videoId,
    videoId,
  );
  const before = api.calls.length;
  await upload(setup, api);
  assert.deepEqual(
    api.calls.slice(before).map((call) => call.path),
    ["/authoring/import/materials/environment"],
  );
});

test("a real provider endpoint is refused before any byte is sent", async (t) => {
  const setup = await fixture(t);
  const api = providerApi({
    endpoint: "https://uploader.kinescope.io/v2/init/abc",
  });
  await assert.rejects(upload(setup, api), /separate owner approval/u);
  assert.equal(
    Object.values((await setup.read()).resources)[0].phase,
    "transfer",
  );
  assert.equal(transferRequired("https://uploads.invalid/x"), false);
  assert.equal(transferRequired("https://uploader.kinescope.io/x"), true);
});

test("an unknown upload outcome stops without a new key", async (t) => {
  const setup = await fixture(t);
  const api = {
    async request(path) {
      if (path.endsWith("/environment")) return { mode: "development" };
      throw Object.assign(new Error("409"), {
        body: { code: "upload_outcome_unknown" },
      });
    },
  };
  await assert.rejects(upload(setup, api), /unknown; inspect the attempt/u);
  const first = Object.values((await setup.read()).resources)[0].idempotencyKey;
  await assert.rejects(upload(setup, api), /unknown/u);
  assert.equal(
    Object.values((await setup.read()).resources)[0].idempotencyKey,
    first,
  );
});

test("a Material that was never synchronized cannot receive a recording", async (t) => {
  const setup = await fixture(t);
  await assert.rejects(
    uploadVideo({
      stateDirectory: setup.state,
      sourceId: "inside-content:other",
      file: setup.file,
      request: providerApi().request,
    }),
    /Synchronize/u,
  );
});

test("a failed provider outcome lets the same file start a new attempt", async (t) => {
  const setup = await fixture(t);
  let state = "failed";
  const keys = [];
  const api = {
    async request(path, body, key) {
      if (path.endsWith("/environment")) return { mode: "development" };
      if (path.endsWith("/uploads")) {
        keys.push(key);
        return {
          providerVideoId: `provider-${String(keys.length)}`,
          uploadEndpoint: "https://uploads.invalid/x",
          video: { videoId, materialId, state: "uploading" },
        };
      }
      if (path.endsWith("/reconcile"))
        return { videoId, materialId, state, durationSeconds: 600 };
      throw new Error(`Unexpected ${path}`);
    },
  };
  await assert.rejects(upload(setup, api), /video is failed/u);
  state = "ready";
  const result = await upload(setup, api);
  assert.equal(new Set(keys).size, 2);
  assert.equal(result.providerVideoId, "provider-2");
});
