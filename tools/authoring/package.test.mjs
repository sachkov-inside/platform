import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, loadPackage } from "./package.mjs";
import { applyJournaled, withJournal } from "./journal.mjs";

const material = { sourceId: "one", sourcePath: "materials/one.md", sourceIds: [], relatedMaterialIds: [], readingTimeMinutes: null, kind: "note", title: "One", summary: "Summary", stage: "draft", topicId: null, access: "membership", showInFeed: false, difficulty: null, outcomes: [], markdown: "Text", links: {}, images: {}, coverAssetId: null, coverAlt: null, video: null, videoChapters: [], artifacts: [] };
const fixture = () => ({ schemaVersion: 1, sourceNamespace: "inside-content", selection: { guideId: null, chapterIds: [], materialIds: ["one"], complete: true }, materials: [material], guides: [], assets: [], diagnostics: [] });
async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), "authoring-package-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("package selection, paid access and raw checksum survive loading", async (t) => {
  const root = await temporary(t);
  const path = join(root, "package.json");
  await writeFile(path, canonical(fixture()));
  const loaded = await loadPackage(path);
  assert.equal(loaded.manifest.materials[0].access, "membership");
  assert.equal(loaded.id.length, 64);
  const invalid = fixture(); invalid.selection.materialIds = ["missing"];
  await writeFile(path, canonical(invalid));
  await assert.rejects(loadPackage(path), /Selection/);
});

test("unrecognized provider fields and escaping source paths fail closed", async (t) => {
  const root = await temporary(t);
  const path = join(root, "package.json");
  for (const altered of [{ ...material, sourcePath: "../secrets.md" }, { ...material, video: { kinescopeId: "06af55ae-3cb9-4868-b845-6a5cd7dff46b", token: "secret" } }]) {
    await writeFile(path, canonical({ ...fixture(), materials: [altered] }));
    await assert.rejects(loadPackage(path));
  }
});

test("uncertain requests persist before transmission and retry the same key", async (t) => {
  const root = await temporary(t);
  const keys = [];
  const request = { materialId: "one", expectedContentVersion: 2, body: "original" };
  await assert.rejects(withJournal(root, "http://127.0.0.1:3101", async (context) => {
    await applyJournaled(context, request, async (sent, key) => {
      keys.push(key);
      assert.deepEqual(sent, request);
      const stored = JSON.parse(await readFile(join(root, "journal.json"), "utf8"));
      assert.equal(stored.operations[key].status, "pending");
      throw new Error("Connection lost after commit");
    });
  }), /Connection lost/);
  await withJournal(root, "http://127.0.0.1:3101", async (context) => {
    const result = await applyJournaled(context, request, async (_, key) => { keys.push(key); return { contentVersion: 3 }; });
    assert.deepEqual(result, { contentVersion: 3 });
    await applyJournaled(context, request, () => { throw new Error("Applied entry must not be sent twice"); });
  });
  assert.equal(keys[0], keys[1]);
  await assert.rejects(withJournal(root, "https://different.example", () => {}), /another environment/);
});

test("another writer cannot apply to the same target concurrently", async (t) => {
  const root = await temporary(t);
  await withJournal(root, "local", async () => {
    await assert.rejects(withJournal(root, "local", () => {}), { code: "ELOCKED" });
  });
});
