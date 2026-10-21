// @ts-check
import { z } from "zod";
import { parseJournal } from "./local-boundaries.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { previewPublication, applyPublication } from "./publication.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("publication preview and replay use source identity and version without a prepared package", async (t) => {
  const state = await mkdtemp(join(tmpdir(), "publication-only-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  let version = 4;
  let status = "published";
  let loseResponse = true;
  /** @type {Map<string, unknown>} */
  const receipts = new Map();
  /** @type {Record<string, unknown>[]} */
  const writes = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path, body, key) => {
    if (path.endsWith("/environment")) return { mode: "development" };
    if (path === `/authoring/materials/${materialId}`)
      return {
        materialId,
        contentVersion: version,
        publicationState: status,
        source: { id: "inside:one" },
        metadata: { title: "new B" },
      };
    assert.equal(path, "/authoring/import/materials/publication");
    writes.push(z.record(z.string(), z.unknown()).parse(body));
    assert.ok(typeof key === "string");
    if (!receipts.has(key)) {
      assert.deepEqual(body, {
        materialId,
        sourceId: "inside:one",
        expectedContentVersion: 4,
        publicationState: "unpublished",
        confirmedProductRemovals: [],
      });
      version++;
      status = "unpublished";
      receipts.set(key, {
        materialId,
        contentVersion: version,
        publicationState: status,
        publishedAt: null,
      });
    }
    if (loseResponse) {
      loseResponse = false;
      throw new Error("lost response");
    }
    return receipts.get(key);
  };
  const { path, preview } = await previewPublication(state, {
    origin: "editor",
    materialId,
    sourceId: "inside:one",
    publicationState: "unpublished",
    request,
  });
  assert.equal(preview.scope, "material-publication");
  assert.equal(preview.expectedContentVersion, 4);
  await assert.rejects(
    applyPublication(path, state, { request }),
    /lost response/,
  );
  await applyPublication(path, state, { request });
  await applyPublication(path, state, { request });
  assert.equal(version, 5);
  assert.equal(writes.length, 2);
  assert.equal(
    writes.some(
      (body) => "body" in body || "metadata" in body || "source" in body,
    ),
    false,
  );
  const journal = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  assert.equal(Object.keys(journal.operations).length, 1);
});

test("publication rejects changed identity, version, environment and edited plans before mutation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "publication-guards-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let version = 4;
  let owner = "inside:one";
  let mode = "development";
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path) => {
    if (path.endsWith("/environment")) return { mode };
    assert.equal(path, `/authoring/materials/${materialId}`);
    return {
      materialId,
      contentVersion: version,
      publicationState: "published",
      source: { id: owner },
      metadata: { title: "B" },
    };
  };
  const options = {
    origin: "editor",
    materialId,
    sourceId: "inside:one",
    publicationState: /** @type {const} */ ("unpublished"),
    request,
  };
  const { path } = await previewPublication(directory, options);
  version = 5;
  await assert.rejects(
    applyPublication(path, directory, { request }),
    /target changed/,
  );
  version = 4;
  owner = "foreign:one";
  await assert.rejects(
    previewPublication(directory, options),
    /identity mismatch/,
  );
  await assert.rejects(
    applyPublication(path, directory, { request }),
    /target changed/,
  );
  owner = "inside:one";
  mode = "production";
  await assert.rejects(
    applyPublication(path, directory, { request }),
    /reports a production runtime/,
  );
  mode = "development";
  const plan = z
    .object({ publicationState: z.string() })
    .passthrough()
    .parse(JSON.parse(await readFile(path, "utf8")));
  plan.publicationState = "published";
  await writeFile(path, JSON.stringify(plan));
  await assert.rejects(
    applyPublication(path, directory, { request }),
    /changed after review/,
  );
});
