// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  canonical,
  checksum,
  loadPackage,
  materialRevision,
} from "./package.mjs";
import { desiredMaterial, syncLocal, reviewOrigin } from "./local-sync.mjs";
import { taskDigest } from "./task-import.mjs";
import {
  parseJournal,
  parseReceipt,
  uploadReceiptSchema,
} from "./local-boundaries.mjs";
import { applyJournaled, withJournal } from "./journal.mjs";
import { itemAt } from "./test-support.mjs";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const opaque = { guideId: "authored", access: "membership", guides: ["text"] };
const provenance = {
  repository: "inside/content",
  commit: "a".repeat(40),
  path: "tasks/build.json",
};
// Fingerprints captured from the pre-#1065 envelope (guide/membership), not the decoded objects.
const revision =
  "5985331c4d279f1ee479faa7eae69534878801cc28a2e4200945a43420c2f39d";
const taskFingerprint =
  "b029b1c0cf2bc02951889c86824486c1246fc61921e3d3702e6228d81d98b269";
const legacyMaterial = {
  sourceId: "one",
  sourcePath: "one.md",
  sourceIds: [],
  relatedMaterialIds: [],
  readingTimeMinutes: null,
  kind: "guide",
  title: "Guide",
  summary: "A material guide",
  stage: "draft",
  topicId: null,
  access: "membership",
  showInFeed: false,
  difficulty: null,
  outcomes: [],
  markdown: "guideId guides membership /guides/ are authored text",
  links: {},
  images: {},
  coverAssetId: null,
  coverAlt: null,
  video: null,
  videoChapters: [],
  artifacts: [],
};
const legacyTask = {
  sourceId: "build",
  guideId: "course",
  chapterId: "start",
  title: "Build",
  access: "membership",
  definition: opaque,
  relatedMaterialIds: ["one"],
  publicationState: "unpublished",
  provenance,
};
const legacyPackage = () => ({
  schemaVersion: 1,
  sourceNamespace: "inside-content",
  selection: {
    guideId: "course",
    chapterIds: [],
    materialIds: ["one"],
    complete: true,
  },
  materials: [structuredClone(legacyMaterial)],
  guides: [
    {
      sourceId: "course",
      title: "Course",
      summary: "Text about guides and membership",
      page: { blocks: [opaque] },
      complete: true,
      chapters: [
        {
          sourceId: "start",
          title: "Start",
          summary: "",
          materialIds: ["one"],
        },
      ],
      materialIds: ["one"],
      supplementaryMaterialIds: [],
    },
  ],
  tasks: [structuredClone(legacyTask)],
  assets: [],
  diagnostics: [],
});
const legacyApply = () => ({
  path: "/authoring/import/materials/apply",
  body: {
    source: {
      id: "inside-content:one",
      path: "one.md",
      revision,
      showInFeed: false,
    },
    materialId: id,
    expectedContentVersion: 1,
    publicationState: "draft",
    metadata: {
      title: "Guide",
      summary: "A material guide",
      access: "membership",
      difficulty: null,
      outcomes: [],
      topicId: null,
      formatId: "guide",
      tagIds: [],
      seriesIds: [],
    },
    body: { schemaVersion: 1, doc: opaque },
    primaryVideoId: null,
    videoChapters: [],
  },
});
const legacyJournal = () => {
  const request = legacyApply();
  return {
    schemaVersion: 1,
    target: reviewOrigin,
    materials: {
      "inside-content:one": {
        materialId: id,
        contentVersion: 1,
        digest: "b".repeat(64),
        revision,
        access: "membership",
        defaultAccess: "membership",
        guideSourceIds: ["course"],
      },
    },
    guides: {
      "inside-content:course": { guideId: id, slug: "course", version: 2 },
    },
    operations: {
      [`authoring:${checksum(canonical(request))}`]: {
        status: "pending",
        request,
      },
    },
    resources: { "opaque:author": opaque },
  };
};

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "authoring-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "package.json");
  const state = join(root, "state");
  await mkdir(state);
  return { root, path, state };
}

test("v1 package upgrades structural aliases and preserves the raw artifact and authored content", async (t) => {
  const { path } = await fixture(t);
  const original = legacyPackage();
  const bytes = canonical(original);
  await writeFile(path, bytes);
  const pkg = await loadPackage(path);
  assert.equal(pkg.id, checksum(bytes));
  assert.equal(await readFile(path, "utf8"), bytes);
  assert.equal(pkg.manifest.selection.productId, "course");
  assert.deepEqual(pkg.manifest.products, original.guides);
  const row = itemAt(pkg.manifest.materials, 0);
  assert.equal(row.kind, "guide");
  assert.equal(row.access, "closed");
  assert.equal(row.markdown, legacyMaterial.markdown);
  const task = itemAt(pkg.manifest.tasks ?? [], 0);
  assert.equal(task.productId, "course");
  assert.equal(task.access, "closed");
  assert.deepEqual(task.definition, opaque);
  const desired = desiredMaterial(pkg.manifest, row, {
    topicIds: new Map(),
    productIds: new Map([["course", id]]),
    defaultAccess: "closed",
    primaryVideoId: null,
    publicationState: "draft",
  });
  assert.equal(desired.metadata.formatId, "guide");
  assert.equal(
    desired.digest,
    "dd3eef26f8e685f630832abcc41f3d338285255a66060123cf673ec987561089",
  );
  const formatModule = new URL(
    "../../apps/backend/src/modules/materials/domain/material-format.ts",
    import.meta.url,
  );
  execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { materialFormatSchema } from ${JSON.stringify(formatModule.href)}; materialFormatSchema.parse(${JSON.stringify(desired.metadata.formatId)});`,
  ]);
});

test("v1 source revisions keep practice sidecars valid and task fingerprints survive canonical re-export", async (t) => {
  const { path } = await fixture(t);
  const original = {
    ...legacyPackage(),
    practiceDefinitions: [
      {
        practiceId: "inside-content:practice",
        definition: opaque,
        sourceReference: {
          materialSourceId: "inside-content:one",
          materialSourceRevision: revision,
        },
        publicationState: "unpublished",
        provenance,
      },
    ],
  };
  await writeFile(path, canonical(original));
  const pkg = await loadPackage(path);
  assert.equal(
    materialRevision(pkg.manifest, itemAt(pkg.manifest.materials, 0)),
    revision,
  );
  assert.deepEqual(
    pkg.manifest.practiceDefinitions,
    original.practiceDefinitions,
  );
  assert.equal(
    taskDigest(
      pkg.manifest,
      itemAt(pkg.manifest.tasks ?? [], 0),
      "unpublished",
    ),
    taskFingerprint,
  );
  await writeFile(path, canonical(pkg.manifest));
  const exported = await loadPackage(path);
  assert.equal(
    materialRevision(exported.manifest, itemAt(exported.manifest.materials, 0)),
    revision,
  );
  assert.equal(
    taskDigest(
      exported.manifest,
      itemAt(exported.manifest.tasks ?? [], 0),
      "unpublished",
    ),
    taskFingerprint,
  );
});

test("v1 journal decodes cache aliases while preserving exact pending requests, keys and opaque resources", async (t) => {
  const { state } = await fixture(t);
  const original = legacyJournal();
  const before = structuredClone(original);
  const parsed = parseJournal(original);
  assert.equal(parsed.products["inside-content:course"]?.productId, id);
  assert.equal(parsed.materials["inside-content:one"]?.access, "closed");
  assert.equal(parsed.materials["inside-content:one"]?.defaultAccess, "closed");
  assert.deepEqual(parsed.materials["inside-content:one"]?.productSourceIds, [
    "course",
  ]);
  assert.deepEqual(parsed.operations, original.operations);
  assert.deepEqual(parsed.resources, original.resources);
  assert.deepEqual(original, before, "decoding must not mutate saved input");
  await writeFile(join(state, "journal.json"), canonical(original));
  await withJournal(state, reviewOrigin, ({ journal }) => {
    assert.deepEqual(journal.operations, original.operations);
  });
  const reloaded = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  assert.deepEqual(reloaded.operations, original.operations);
  assert.deepEqual(reloaded.resources, original.resources);
});

test("continuing a canonical task request reuses the legacy key and original request", async (t) => {
  const { state } = await fixture(t);
  const old = {
    path: "/authoring/import/tasks/apply",
    body: { guideId: id, access: "membership", definition: opaque },
  };
  const current = {
    path: old.path,
    body: { productId: id, access: "closed", definition: opaque },
  };
  const key = `authoring:${checksum(canonical(old))}`;
  const original = {
    ...legacyJournal(),
    operations: { [key]: { status: "pending", request: old } },
  };
  await writeFile(join(state, "journal.json"), canonical(original));
  await withJournal(state, reviewOrigin, async (context) => {
    const result = await applyJournaled(
      context,
      current,
      async (sent, reusedKey) => {
        assert.equal(reusedKey, key);
        assert.deepEqual(
          sent,
          old,
          "only the local-sync transport may canonicalize the saved request",
        );
        return { committed: true };
      },
    );
    assert.deepEqual(result, { committed: true });
    assert.deepEqual(Object.keys(context.journal.operations), [key]);
    await applyJournaled(context, current, async () =>
      assert.fail("applied receipt must be reused"),
    );
  });
  const saved = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  assert.deepEqual(saved.operations[key]?.request, old);
});

test("local-sync replays legacy material and task receipts over canonical requests after a lost response", async (t) => {
  const { path, state } = await fixture(t);
  await writeFile(path, canonical(legacyPackage()));
  const materialRequest = legacyApply();
  const taskRequest = {
    path: "/authoring/import/tasks/apply",
    body: {
      sourceId: "inside-content:build",
      code: "build",
      title: "Build",
      guideId: id,
      chapterId: id,
      position: 1,
      access: "membership",
      definition: opaque,
      relatedMaterialSourceIds: [],
      publicationState: "unpublished",
      expectedRevision: null,
      provenance,
    },
  };
  const materialKey = `authoring:${checksum(canonical(materialRequest))}`;
  const taskKey = `authoring:${checksum(canonical(taskRequest))}`;
  const original = {
    ...legacyJournal(),
    operations: {
      [materialKey]: { status: "pending", request: materialRequest },
      [taskKey]: { status: "pending", request: taskRequest },
    },
  };
  await writeFile(join(state, "journal.json"), canonical(original));
  let loseResponse = true;
  /** @type {string[]} */
  const sentKeys = [];
  const options = {
    reconcileOnly: true,
    /** @type {import("./target.mjs").LocalTransport} */
    request: async (apiPath, body, key) => {
      if (apiPath.endsWith("/environment")) return { mode: "development" };
      assert.ok(key !== undefined);
      sentKeys.push(key);
      if (apiPath === materialRequest.path) {
        assert.equal(key, materialKey);
        assert.deepEqual(body, {
          ...materialRequest.body,
          metadata: { ...materialRequest.body.metadata, access: "closed" },
        });
        if (loseResponse) {
          loseResponse = false;
          throw new Error("Lost response after legacy receipt committed");
        }
        return { materialId: id, contentVersion: 2 };
      }
      assert.equal(apiPath, taskRequest.path);
      assert.equal(key, taskKey);
      const { guideId, ...oldBody } = taskRequest.body;
      assert.deepEqual(body, {
        ...oldBody,
        productId: guideId,
        access: "closed",
      });
      return {
        taskId: id,
        code: "build",
        revision: 1,
        currentVersion: 1,
        definitionDigest: "c".repeat(64),
        publicationState: "unpublished",
      };
    },
  };
  await assert.rejects(syncLocal(path, state, options), /Lost response/u);
  assert.deepEqual(
    parseJournal(
      JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
    ).operations,
    original.operations,
  );
  await syncLocal(path, state, options);
  const saved = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  assert.deepEqual(
    Object.keys(saved.operations).sort(),
    [materialKey, taskKey].sort(),
  );
  assert.deepEqual(saved.operations[materialKey]?.request, materialRequest);
  assert.deepEqual(saved.operations[taskKey]?.request, taskRequest);
  assert.equal(saved.operations[materialKey]?.status, "applied");
  assert.equal(saved.operations[taskKey]?.status, "applied");
  await syncLocal(path, state, options);
  assert.deepEqual(sentKeys, [materialKey, materialKey, taskKey]);
});

test("a saved guide-shell package loads as a Product shell with its original artifact identity", async (t) => {
  const { path } = await fixture(t);
  const original = legacyPackage();
  const shell = {
    ...original,
    selection: { ...original.selection, materialIds: [], scope: "guide-shell" },
    materials: [],
    tasks: [],
    guides: original.guides.map((guide) => ({
      ...guide,
      materialIds: [],
      chapters: guide.chapters.map((chapter) => ({
        ...chapter,
        materialIds: [],
      })),
    })),
  };
  const bytes = canonical(shell);
  await writeFile(path, bytes);
  const pkg = await loadPackage(path);
  assert.equal(pkg.manifest.selection.scope, "product-shell");
  assert.equal(pkg.id, checksum(bytes));
  assert.equal(await readFile(path, "utf8"), bytes);
});

test("package aliases collide even when their values agree; unknown fields and noncanonical input still fail", async (t) => {
  const { path } = await fixture(t);
  const original = legacyPackage();
  for (const value of [
    { ...original, products: original.guides },
    { ...original, selection: { ...original.selection, productId: "course" } },
    { ...original, tasks: [{ ...legacyTask, productId: "course" }] },
  ]) {
    await writeFile(path, canonical(value));
    await assert.rejects(loadPackage(path), /alias collision/u);
  }
  for (const bytes of [
    JSON.stringify(original, null, 2),
    canonical({ ...original, unexpected: true }),
    canonical({ ...original, tasks: [{ ...legacyTask, title: " Build " }] }),
    canonical({
      ...original,
      materials: [{ ...legacyMaterial, kind: "product" }],
    }),
  ]) {
    await writeFile(path, bytes);
    await assert.rejects(loadPackage(path));
  }
});

test("journal aliases and duplicate logical operations fail before the file is rewritten", async (t) => {
  const { state } = await fixture(t);
  const original = legacyJournal();
  const old = legacyApply();
  const current = {
    ...old,
    body: { ...old.body, metadata: { ...old.body.metadata, access: "closed" } },
  };
  for (const value of [
    { ...original, products: original.guides },
    {
      ...original,
      guides: { course: { guideId: id, productId: id, slug: "course" } },
    },
    {
      ...original,
      materials: {
        one: {
          ...original.materials["inside-content:one"],
          productSourceIds: ["course"],
        },
      },
    },
    {
      ...original,
      operations: {
        ...original.operations,
        [`authoring:${checksum(canonical(current))}`]: {
          status: "pending",
          request: current,
        },
      },
    },
    {
      ...original,
      operations: {
        [`authoring:${checksum(canonical({ path: "/authoring/import/tasks/apply", body: { guideId: id, productId: id } }))}`]:
          {
            status: "pending",
            request: {
              path: "/authoring/import/tasks/apply",
              body: { guideId: id, productId: id },
            },
          },
      },
    },
  ]) {
    const bytes = canonical(value);
    await writeFile(join(state, "journal.json"), bytes);
    await assert.rejects(
      withJournal(state, reviewOrigin, () =>
        assert.fail("collision cannot run"),
      ),
      /alias collision/u,
    );
    assert.equal(await readFile(join(state, "journal.json"), "utf8"), bytes);
  }
});

test("a continued Product composition finds the old path and field aliases for applied and rejected operations", async (t) => {
  const { state } = await fixture(t);
  const old = {
    path: "/authoring/import/guides/composition",
    body: {
      guideId: id,
      guideSourceId: "inside-content:course",
      guideSourceIds: ["course"],
      page: opaque,
    },
  };
  const current = {
    path: "/authoring/import/products/composition",
    body: {
      productId: id,
      productSourceId: "inside-content:course",
      productSourceIds: ["course"],
      page: opaque,
    },
  };
  const key = `authoring:${checksum(canonical(old))}`;
  for (const entry of [
    {
      status: "applied",
      request: old,
      result: { orderVersion: "d".repeat(64) },
    },
    {
      status: "rejected",
      request: old,
      error: { status: 422, message: "Original rejection" },
    },
  ]) {
    await writeFile(
      join(state, "journal.json"),
      canonical({ ...legacyJournal(), operations: { [key]: entry } }),
    );
    await withJournal(state, reviewOrigin, async (context) => {
      const apply = () =>
        applyJournaled(context, current, async () =>
          assert.fail("a settled legacy operation cannot send again"),
        );
      if (entry.status === "applied")
        assert.deepEqual(await apply(), entry.result);
      else await assert.rejects(apply(), /Original rejection/u);
      assert.deepEqual(Object.keys(context.journal.operations), [key]);
      assert.deepEqual(context.journal.operations[key]?.request, old);
    });
  }
});

test("a legacy upload receipt changes only its structural access and keeps its upload key", () => {
  const key = `upload:${id}:${"e".repeat(64)}`;
  const upload = {
    phase: "initializing",
    sourceId: "inside-content:one",
    idempotencyKey: "original-upload-key",
    byteSize: 25,
    filename: "guide-membership.mp4",
    title: "guides membership",
    access: "membership",
  };
  const parsed = parseJournal({
    ...legacyJournal(),
    resources: { [key]: upload, "opaque:author": opaque },
  });
  assert.deepEqual(parseReceipt(uploadReceiptSchema, parsed.resources?.[key]), {
    ...upload,
    access: "closed",
  });
  assert.deepEqual(parsed.resources?.["opaque:author"], opaque);
  assert.equal(upload.access, "membership");
});
