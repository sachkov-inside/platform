// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, checksum, manifestSchema } from "./package.mjs";
import { parseJournal } from "./local-boundaries.mjs";
import {
  previewRetirement,
  applyRetirement,
  retirementPreviewSchema,
} from "./retirement.mjs";
import { applyRelease } from "./release.mjs";

const keepId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const oldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const state = await mkdtemp(join(tmpdir(), "authoring-retirement-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  const packagePath = join(state, "package.json");
  const manifest = {
    schemaVersion: 1,
    sourceNamespace: "inside-content",
    selection: {
      productId: "course",
      chapterIds: [],
      materialIds: ["keep"],
      complete: true,
    },
    materials: [
      {
        sourceId: "keep",
        sourcePath: "keep.md",
        sourceIds: [],
        relatedMaterialIds: [],
        readingTimeMinutes: null,
        kind: "note",
        title: "Keep",
        summary: "Summary",
        stage: "published",
        topicId: null,
        access: "closed",
        showInFeed: false,
        difficulty: null,
        outcomes: [],
        markdown: "Keep text",
        links: {},
        images: {},
        coverAssetId: null,
        coverAlt: null,
        video: null,
        videoChapters: [],
        artifacts: [],
      },
    ],
    products: [
      {
        sourceId: "course",
        title: "Course",
        summary: "",
        complete: true,
        chapters: [],
        materialIds: ["keep"],
        supplementaryMaterialIds: [],
      },
    ],
    assets: [],
    diagnostics: [],
  };
  await writeFile(packagePath, canonical(manifest));
  await writeFile(
    join(state, "journal.json"),
    canonical({
      schemaVersion: 1,
      target: "http://127.0.0.1:4396",
      materials: {
        "inside-content:keep": {
          materialId: keepId,
          contentVersion: 2,
          digest: "b".repeat(64),
        },
      },
      products: {},
      operations: {},
    }),
  );
  const source = {
    id: "inside-content:old",
    path: "old.md",
    revision: "a".repeat(64),
    showInFeed: true,
  };
  const old = {
    legacyPractices:
      /** @type {{practiceId:string;practiceVersion:number;definitionDigest:string}[]} */ ([]),
    materialId: oldId,
    contentVersion: 2,
    publicationState: "published",
    firstPublishedAt: /** @type {string | null} */ ("2026-10-01T00:00:00.000Z"),
    publishedAt: /** @type {string | null} */ ("2026-10-01T00:00:00.000Z"),
    primaryVideoId: /** @type {string | null} */ (null),
    primaryVideo: null,
    cover: null,
    source,
    body: {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Original" }] },
        ],
      },
    },
    metadata: {
      slug: "old",
      title: "Old",
      summary: "Old summary",
      access: "closed",
      difficulty: null,
      outcomes: [],
      topicId: null,
      formatId: "note",
      tagIds: [],
      seriesMemberships:
        /** @type {{seriesId: string; ordinal: number}[]} */ ([]),
    },
  };
  const keep = {
    ...structuredClone(old),
    materialId: keepId,
    source: { ...source, id: "inside-content:keep" },
  };
  const records = new Map([
    [oldId, old],
    [keepId, keep],
  ]);
  /** @type {{ key: string | undefined; body: unknown }[]} */
  const writes = [];
  /** @type {Map<string | undefined, unknown>} */
  const receipts = new Map();
  let loseReceipt = false;
  /** @type {import("./target.mjs").LocalTransport} */
  const request = async (path, body, key) => {
    if (path.endsWith("/environment")) return { mode: "development" };
    if (body === undefined) {
      const row = records.get(path.split("/").at(-1) ?? "");
      if (!row) throw Object.assign(new Error("Missing"), { status: 404 });
      return structuredClone(row);
    }
    writes.push({ key, body: structuredClone(body) });
    if (receipts.has(key)) return receipts.get(key);
    if (path === "/authoring/import/materials/delete-draft") {
      assert.deepEqual(body, {
        expectedLegacyPractices: old.legacyPractices,
        sourceId: old.source.id,
        materialId: oldId,
        expectedContentVersion: 2,
      });
      records.delete(oldId);
      const receipt = { materialId: oldId };
      receipts.set(key, receipt);
      if (loseReceipt) {
        loseReceipt = false;
        throw new Error("Lost receipt");
      }
      return receipt;
    }
    assert.equal(path, "/authoring/import/materials/apply");
    assert.deepEqual(body, {
      source: old.source,
      materialId: oldId,
      expectedContentVersion: 2,
      publicationState: "unpublished",
      primaryVideoId: null,
      metadata: {
        title: "Old",
        summary: "Old summary",
        access: "closed",
        difficulty: null,
        outcomes: [],
        topicId: null,
        formatId: "note",
        tagIds: [],
        seriesIds: [],
      },
      body: old.body,
    });
    old.publicationState = "unpublished";
    old.contentVersion++;
    const receipt = {
      materialId: oldId,
      contentVersion: 3,
      publicationState: "unpublished",
      publishedAt: old.publishedAt,
    };
    receipts.set(key, receipt);
    if (loseReceipt) {
      loseReceipt = false;
      throw new Error("Lost receipt");
    }
    return receipt;
  };
  const options = {
    origin: "http://127.0.0.1:4396",
    materialIds: [oldId],
    request,
  };
  return {
    state,
    packagePath,
    old,
    keep,
    records,
    writes,
    options,
    loseNextReceipt: () => {
      loseReceipt = true;
    },
  };
}

test("retirement preserves the original and replays a lost receipt with the same key", async (t) => {
  const setup = await fixture(t);
  const original = structuredClone(setup.old);
  const keep = structuredClone(setup.keep);
  const { path } = await previewRetirement(
    setup.packagePath,
    setup.state,
    setup.options,
  );
  assert.equal(setup.writes.length, 0);
  setup.loseNextReceipt();
  await assert.rejects(
    applyRetirement(path, setup.state, { request: setup.options.request }),
    /Lost receipt/u,
  );
  const result = await applyRetirement(path, setup.state, {
    request: setup.options.request,
  });
  assert.deepEqual(result.archived, [{ sourceId: "inside-content:old" }]);
  assert.deepEqual(setup.old, {
    ...original,
    publicationState: "unpublished",
    contentVersion: 3,
  });
  assert.deepEqual(setup.keep, keep);
  assert.equal(setup.writes.length, 2);
  assert.equal(setup.writes[0]?.key, setup.writes[1]?.key);
  await applyRetirement(path, setup.state, { request: setup.options.request });
  assert.equal(setup.writes.length, 2);
});

test("source draft deletion is reviewed separately, preserves canonical Materials and recovers a lost receipt", async (t) => {
  const setup = await fixture(t);
  setup.old.publicationState = "draft";
  setup.old.firstPublishedAt = null;
  setup.old.publishedAt = null;
  setup.old.source.id = "inside-task-page:inside-content:obsolete";
  const options = { ...setup.options, deleteDrafts: true };
  const { path, preview } = await previewRetirement(
    setup.packagePath,
    setup.state,
    options,
  );
  assert.equal(preview.scope, "source-draft-deletion");
  const keep = structuredClone(setup.keep);
  setup.loseNextReceipt();
  await assert.rejects(
    applyRelease(path, setup.state, { request: options.request }),
    /Lost receipt/u,
  );
  const result = await applyRelease(path, setup.state, {
    request: options.request,
  });
  assert.ok("deleted" in result);
  assert.deepEqual(result.deleted, [{ sourceId: setup.old.source.id }]);
  assert.equal(setup.records.has(oldId), false);
  assert.deepEqual(setup.keep, keep);
  assert.equal(setup.writes[0]?.key, setup.writes[1]?.key);
  await applyRelease(path, setup.state, { request: options.request });
  assert.equal(setup.writes.length, 2);
});

test("canonical, foreign, unknown, duplicate and draft targets fail without a write", async (t) => {
  const setup = await fixture(t);
  for (const materialIds of [
    [keepId],
    ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    [oldId, oldId],
  ]) {
    await assert.rejects(
      previewRetirement(setup.packagePath, setup.state, {
        ...setup.options,
        materialIds,
      }),
    );
  }
  setup.old.source.id = "foreign:old";
  await assert.rejects(
    previewRetirement(setup.packagePath, setup.state, setup.options),
    /namespace/u,
  );
  setup.old.source.id = "inside-content:old";
  setup.old.publicationState = "draft";
  await assert.rejects(
    previewRetirement(setup.packagePath, setup.state, setup.options),
    /draft/u,
  );
  assert.equal(setup.writes.length, 0);
});

test("draft deletion refuses published history, Product membership, videos and foreign sources", async (t) => {
  const setup = await fixture(t);
  const options = { ...setup.options, deleteDrafts: true };
  await assert.rejects(
    previewRetirement(setup.packagePath, setup.state, options),
  );
  setup.old.publicationState = "draft";
  await assert.rejects(
    previewRetirement(setup.packagePath, setup.state, options),
  );
  setup.old.firstPublishedAt = null;
  setup.old.primaryVideoId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await assert.rejects(
    previewRetirement(setup.packagePath, setup.state, options),
  );
  setup.old.primaryVideoId = null;
  setup.old.metadata.seriesMemberships = [
    { seriesId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ordinal: 1 },
  ];
  await assert.rejects(
    previewRetirement(setup.packagePath, setup.state, options),
  );
  setup.old.metadata.seriesMemberships = [];
  setup.old.source.id = "inside-task-page:foreign:old";
  await assert.rejects(
    previewRetirement(setup.packagePath, setup.state, options),
  );
  assert.equal(setup.writes.length, 0);
});

test("legacy practice drift stops deletion before writing even when Material version is unchanged", async (t) => {
  const setup = await fixture(t);
  setup.old.publicationState = "draft";
  setup.old.firstPublishedAt = null;
  setup.old.legacyPractices = [
    {
      practiceId: "inside-content:old",
      practiceVersion: 1,
      definitionDigest: "a".repeat(64),
    },
  ];
  const { path } = await previewRetirement(setup.packagePath, setup.state, {
    ...setup.options,
    deleteDrafts: true,
  });
  setup.old.legacyPractices = [
    {
      practiceId: "inside-content:old",
      practiceVersion: 2,
      definitionDigest: "b".repeat(64),
    },
  ];
  await assert.rejects(
    applyRelease(path, setup.state, { request: setup.options.request }),
    /changed after preview/u,
  );
  assert.equal(setup.writes.length, 0);
});

test("drift of any target or protected Material invalidates the entire plan before writing", async (t) => {
  const setup = await fixture(t);
  const second = {
    ...structuredClone(setup.old),
    materialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    source: { ...setup.old.source, id: "inside-content:other" },
  };
  setup.records.set(second.materialId, second);
  const { path } = await previewRetirement(setup.packagePath, setup.state, {
    ...setup.options,
    materialIds: [oldId, second.materialId],
  });
  second.contentVersion++;
  await assert.rejects(
    applyRelease(path, setup.state, { request: setup.options.request }),
    /changed after preview/u,
  );
  second.contentVersion--;
  setup.keep.contentVersion++;
  await assert.rejects(
    applyRelease(path, setup.state, { request: setup.options.request }),
    /Canonical Materials changed/u,
  );
  setup.keep.contentVersion--;
  setup.old.metadata.title = "Concurrent title";
  await assert.rejects(
    applyRelease(path, setup.state, { request: setup.options.request }),
    /changed after preview/u,
  );
  assert.equal(setup.writes.length, 0);
});

test("tampered preview, changed package and unrelated pending writes cannot be applied", async (t) => {
  const setup = await fixture(t);
  const { path } = await previewRetirement(
    setup.packagePath,
    setup.state,
    setup.options,
  );
  const preview = retirementPreviewSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  await writeFile(path, canonical({ ...preview, environment: "production" }));
  await assert.rejects(
    applyRelease(path, setup.state, { request: setup.options.request }),
    /changed after review/u,
  );
  await writeFile(path, canonical(preview));
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(setup.packagePath, "utf8")),
  );
  await writeFile(
    setup.packagePath,
    canonical({
      ...manifest,
      products: manifest.products.map((row) => ({ ...row, title: "Changed" })),
    }),
  );
  await assert.rejects(
    applyRelease(path, setup.state, { request: setup.options.request }),
  );
  await writeFile(setup.packagePath, canonical(manifest));
  const journalPath = join(setup.state, "journal.json");
  const journal = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
  const request = {
    path: "/authoring/import/materials/reserve",
    body: { source: setup.old.source },
  };
  journal.operations[`authoring:${checksum(canonical(request))}`] = {
    status: "pending",
    request,
  };
  await writeFile(journalPath, canonical(journal));
  await assert.rejects(
    applyRelease(path, setup.state, { request: setup.options.request }),
    /Finish pending/u,
  );
  assert.equal(setup.writes.length, 0);
});
