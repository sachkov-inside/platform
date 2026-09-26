import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical } from "./package.mjs";
import { syncLocal } from "./local-sync.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourceId = "inside-content:one";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-local-sync-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packagePath = join(directory, "package.json");
  const stateDirectory = join(directory, "state");
  const manifest = {
    schemaVersion: 1,
    sourceNamespace: "inside-content",
    selection: {
      guideId: null,
      chapterIds: [],
      materialIds: ["one"],
      complete: true,
    },
    materials: [
      {
        sourceId: "one",
        sourcePath: "materials/one.md",
        sourceIds: [],
        relatedMaterialIds: [],
        readingTimeMinutes: null,
        kind: "note",
        title: "One",
        summary: "Summary",
        stage: "draft",
        topicId: null,
        access: "membership",
        showInFeed: false,
        difficulty: null,
        outcomes: [],
        markdown: "Original text",
        links: {},
        images: {},
        coverAssetId: null,
        coverAlt: null,
        video: null,
        videoChapters: [],
        artifacts: [],
      },
    ],
    guides: [],
    assets: [],
    diagnostics: [],
  };
  const write = () => writeFile(packagePath, canonical(manifest));
  await write();
  return {
    manifest,
    write,
    stateDirectory,
    sync: (api) =>
      syncLocal(packagePath, stateDirectory, { request: api.request }),
  };
}

// Stateful application-API double: receipts are durable before a simulated response loss.
// No mock reaches PostgreSQL, a provider, or the loopback review gateway.
function applicationApi({ loseFirstResponse = false } = {}) {
  const materials = new Map();
  const receipts = new Map();
  const calls = [];
  let commits = 0;
  let loseResponse = loseFirstResponse;
  const api = {
    materials,
    calls,
    get commits() {
      return commits;
    },
    async request(path, body, key) {
      calls.push(structuredClone({ path, body, key }));
      if (path === "/authoring/import/materials/environment")
        return { mode: "development" };
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/import/materials/validate")
        return { valid: true };
      if (path === "/authoring/import/materials/reserve") {
        if (!materials.has(body.source.id))
          materials.set(body.source.id, {
            materialId,
            contentVersion: 1,
            primaryVideoId: null,
            metadata: { slug: "stable-original-url" },
            source: body.source,
          });
        return structuredClone(materials.get(body.source.id));
      }
      if (path === `/authoring/materials/${materialId}`)
        return structuredClone(materials.get(sourceId));
      if (path === "/authoring/import/materials/apply") {
        assert.ok(key, "Every mutation must supply an idempotency key");
        if (receipts.has(key)) {
          const previous = receipts.get(key);
          assert.deepEqual(
            body,
            previous.body,
            "A retry must preserve the exact command",
          );
          return structuredClone(previous.result);
        }
        const current = materials.get(body.source.id);
        assert.equal(body.materialId, current.materialId);
        if (body.expectedContentVersion !== current.contentVersion)
          throw new Error("stale_content_version");
        Object.assign(current, structuredClone(body), {
          contentVersion: current.contentVersion + 1,
          metadata: { ...body.metadata, slug: current.metadata.slug },
        });
        commits++;
        const result = {
          materialId,
          contentVersion: current.contentVersion,
          publicationState: "published",
          publishedAt: "2026-09-15T10:00:00.000Z",
        };
        receipts.set(key, structuredClone({ body, result }));
        if (loseResponse) {
          loseResponse = false;
          throw new Error("Connection lost after commit");
        }
        return result;
      }
      throw new Error(`Unexpected API request: ${path}`);
    },
  };
  return api;
}

const applyCalls = (api) =>
  api.calls.filter((call) => call.path === "/authoring/import/materials/apply");

test("local restart replays a lost response with the original key and creates no extra version", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi({ loseFirstResponse: true });
  await assert.rejects(setup.sync(api), /Connection lost after commit/);
  assert.equal(api.commits, 1);
  const pending = JSON.parse(
    await readFile(join(setup.stateDirectory, "journal.json"), "utf8"),
  );
  const first = applyCalls(api)[0];
  assert.equal(pending.operations[first.key].status, "pending");
  assert.deepEqual(pending.operations[first.key].request.body, first.body);

  const report = await setup.sync(api);
  const calls = applyCalls(api);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(api.commits, 1);
  assert.equal(api.materials.size, 1);
  assert.equal(api.materials.get(sourceId).contentVersion, 2);
  assert.equal(report.unchanged, 1);
  const recovered = JSON.parse(
    await readFile(join(setup.stateDirectory, "journal.json"), "utf8"),
  );
  assert.equal(recovered.operations[first.key].status, "applied");
  assert.equal(recovered.materials[sourceId].contentVersion, 2);
});

test("editing and moving an original retains its material ID and URL and applies the new body once", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const first = await setup.sync(api);
  setup.manifest.materials[0].markdown = "Updated original text";
  setup.manifest.materials[0].sourcePath = "renamed/lesson.md";
  setup.manifest.materials[0].title = "Renamed lesson";
  await setup.write();
  const edited = await setup.sync(api);
  assert.equal(edited.applied, 1);
  assert.equal(edited.materials[0].url, first.materials[0].url);
  assert.equal(api.materials.size, 1);
  const current = api.materials.get(sourceId);
  assert.equal(current.materialId, materialId);
  assert.equal(current.contentVersion, 3);
  assert.equal(current.metadata.title, "Renamed lesson");
  assert.equal(current.metadata.access, "membership");
  assert.equal(current.source.path, "renamed/lesson.md");
  assert.match(JSON.stringify(current.body), /Updated original text/);
  assert.doesNotMatch(JSON.stringify(current.body), /Original text/);
  assert.equal((await setup.sync(api)).unchanged, 1);
  assert.equal(api.commits, 2);
});

test("an unchanged package uses its local cache without another validation, reservation or Save", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await setup.sync(api);
  const before = api.calls.length;
  const report = await setup.sync(api);
  assert.equal(report.applied, 0);
  assert.equal(report.unchanged, 1);
  assert.deepEqual(
    api.calls.slice(before).map(({ path }) => path),
    [
      "/authoring/import/materials/environment",
      "/authoring/collections?kind=topic",
    ],
  );
  assert.equal(api.commits, 1);
  assert.equal(api.materials.get(sourceId).contentVersion, 2);
});

test("an edited original stops on a foreign target version and preserves the foreign body", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await setup.sync(api);
  const current = api.materials.get(sourceId);
  current.contentVersion++;
  current.source = { ...current.source, revision: "f".repeat(64) };
  current.body = { foreign: "Keep this change" };
  setup.manifest.materials[0].markdown = "Conflicting author change";
  await setup.write();
  await assert.rejects(
    setup.sync(api),
    /target changed; reconcile before overwriting/,
  );
  assert.equal(api.commits, 1);
  assert.equal(applyCalls(api).length, 1);
  assert.equal(current.contentVersion, 3);
  assert.deepEqual(current.body, { foreign: "Keep this change" });
  const journal = JSON.parse(
    await readFile(join(setup.stateDirectory, "journal.json"), "utf8"),
  );
  assert.equal(journal.materials[sourceId].contentVersion, 2);
});

test("a definitive 422 rejection does not replay ahead of a corrected package", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const transmitted = [];
  let rejectNextApply = true;
  const transport = {
    async request(path, body, key) {
      if (path === "/authoring/import/materials/apply") {
        transmitted.push(structuredClone({ path, body, key }));
        if (rejectNextApply) {
          rejectNextApply = false;
          throw Object.assign(
            new Error("Invalid reference rejected before commit"),
            { status: 422 },
          );
        }
      }
      return api.request(path, body, key);
    },
  };
  await assert.rejects(setup.sync(transport), { status: 422 });
  assert.equal(api.commits, 0);
  const rejected = JSON.parse(
    await readFile(join(setup.stateDirectory, "journal.json"), "utf8"),
  );
  const first = transmitted[0];
  assert.equal(rejected.operations[first.key].status, "rejected");
  assert.equal(rejected.operations[first.key].error.status, 422);
  assert.equal(api.materials.get(sourceId).contentVersion, 1);

  setup.manifest.materials[0].markdown = "Corrected original text";
  await setup.write();
  const corrected = await setup.sync(transport);
  assert.equal(corrected.applied, 1);
  assert.equal(
    transmitted.length,
    2,
    "The rejected command must not be replayed",
  );
  assert.notEqual(transmitted[1].key, first.key);
  assert.match(
    JSON.stringify(transmitted[1].body.body),
    /Corrected original text/,
  );
  assert.equal(api.commits, 1);
  assert.equal(api.materials.size, 1);
  assert.equal(api.materials.get(sourceId).contentVersion, 2);
  const recovered = JSON.parse(
    await readFile(join(setup.stateDirectory, "journal.json"), "utf8"),
  );
  assert.equal(recovered.operations[first.key].status, "rejected");
  assert.equal(recovered.operations[transmitted[1].key].status, "applied");
  assert.equal((await setup.sync(transport)).unchanged, 1);
  assert.equal(transmitted.length, 2);
});
