import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, checksum } from "./package.mjs";
import { parseLocalResponse, parseJournal } from "./local-boundaries.mjs";
import { syncLocal, reviewOrigin } from "./local-sync.mjs";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "local-boundaries-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packagePath = join(directory, "package.json");
  const state = join(directory, "state");
  await mkdir(state);
  await writeFile(packagePath, canonical({
    schemaVersion: 1, sourceNamespace: "inside-content",
    selection: { guideId: null, chapterIds: [], materialIds: ["one"], complete: true },
    materials: [{ sourceId: "one", sourcePath: "one.md", sourceIds: [], relatedMaterialIds: [], readingTimeMinutes: null, kind: "note", title: "One", summary: "Summary", stage: "draft", topicId: null, access: "free", showInFeed: false, difficulty: null, outcomes: [], markdown: "Text", links: {}, images: {}, coverAssetId: null, coverAlt: null, video: null, videoChapters: [], artifacts: [] }],
    guides: [], assets: [], diagnostics: [],
  }));
  return { packagePath, state };
}

// Every response schema rejects corrupt consumed fields without relying on a transport implementation.
for (const [path, response] of [
  ["/authoring/import/materials/environment", { mode: false }],
  ["/authoring/collections?kind=topic", [{ id: "not-a-uuid", slug: "topic" }]],
  ["/authoring/collections", { id, slug: null }],
  ["/authoring/import/materials/validate", { valid: false }],
  ["/authoring/import/materials/reserve", { materialId: id, contentVersion: "1" }],
  ["/authoring/import/materials/apply", { materialId: id, contentVersion: -1 }],
  [`/authoring/materials/${id}`, { materialId: id, contentVersion: 1, primaryVideoId: null, metadata: { slug: "one" }, source: { revision: 123 } }],
  ["/authoring/import/guides/reserve", { id, slug: "guide", name: "Guide", summary: "", version: null }],
  ["/authoring/import/guides/update", { id, slug: "guide", name: "Guide", summary: "", version: 0 }],
  [`/authoring/guides/${id}/order`, { orderVersion: "corrupt" }],
  ["/authoring/import/guides/composition", { orderVersion: null }],
]) test(`rejects malformed response at ${path}`, () => assert.throws(() => parseLocalResponse(path, response)));

test("malformed injected reservation stops local sync before read or Save", async (t) => {
  const { packagePath, state } = await fixture(t);
  const paths = [];
  await assert.rejects(syncLocal(packagePath, state, { request: async (path) => {
    paths.push(path);
    if (path.endsWith("/environment")) return { mode: "development" };
    if (path === "/authoring/collections?kind=topic") return [];
    if (path.endsWith("/validate")) return { valid: true };
    if (path.endsWith("/reserve")) return { materialId: "../../other-operation", contentVersion: 1 };
    throw new Error(`Unexpected mutation: ${path}`);
  } }), /Invalid UUID/);
  assert.equal(paths.at(-1), "/authoring/import/materials/reserve");
  assert.equal(paths.some((path) => path.endsWith("/apply")), false);
});

test("corrupt recovery entries fail before replay and leave the original journal untouched", async (t) => {
  const { packagePath, state } = await fixture(t);
  const request = { path: "/authoring/import/materials/apply", body: { source: null } };
  const key = `authoring:${checksum(canonical(request))}`;
  for (const entry of [
    { status: "pending", request },
    { status: "applied", request, result: { materialId: id, contentVersion: "2" } },
    { status: "rejected", request, error: { status: 503, message: "Not a definitive rejection" } },
    { assetId: "invalid" },
  ]) {
    const journal = canonical({ schemaVersion: 1, target: reviewOrigin, materials: {}, guides: {}, operations: { [key]: entry } });
    const path = join(state, "journal.json");
    await writeFile(path, journal);
    const calls = [];
    await assert.rejects(syncLocal(packagePath, state, { request: async (apiPath) => {
      calls.push(apiPath);
      assert.equal(apiPath, "/authoring/import/materials/environment");
      return { mode: "development" };
    } }));
    assert.deepEqual(calls, ["/authoring/import/materials/environment"]);
    assert.equal(await readFile(path, "utf8"), journal);
  }
});

test("legacy cache entries remain readable and exact generic pending requests are preserved", () => {
  const request = { materialId: id, expectedContentVersion: 1, body: "Original" };
  const key = `authoring:${checksum(canonical(request))}`;
  const journal = { schemaVersion: 1, target: reviewOrigin, materials: { one: { materialId: id, contentVersion: 2, digest: "a".repeat(64), url: "/materials/one" } }, guides: {}, operations: { [key]: { status: "pending", request }, [`image:${id}:${"b".repeat(64)}`]: { assetId: id, presentation: { width: 640 } } } };
  assert.deepEqual(parseJournal(journal), journal);
  assert.throws(() => parseJournal({ ...journal, operations: { "authoring:wrong-key": { status: "pending", request } } }), /fingerprint mismatch/);
});
