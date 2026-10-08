// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, loadPackage } from "./package.mjs";
import { syncLocal } from "./local-sync.mjs";
import { applyRelease, previewRelease } from "./release.mjs";

/** Synthetic exporter envelope, never real course content. */
function fixture() {
  const page = {
    sourceId: "task-one",
    sourcePath: "tasks/one.md",
    sourceIds: [],
    relatedMaterialIds: [],
    readingTimeMinutes: null,
    kind: "note",
    title: "1. Reader title",
    summary: "Summary",
    stage: "draft",
    topicId: null,
    access: null,
    showInFeed: false,
    difficulty: null,
    outcomes: [],
    markdown: "Task page",
    links: {},
    images: {},
    coverAssetId: null,
    coverAlt: null,
    video: null,
    videoChapters: [],
    artifacts: [],
  };
  return {
    schemaVersion: 2,
    requiredFeatures: ["task-c-v2"],
    sourceNamespace: "synthetic",
    selection: {
      guideId: "course",
      chapterIds: ["chapter"],
      materialIds: [],
      taskIds: ["task-one"],
      complete: true,
    },
    materials: [],
    assets: [],
    diagnostics: [],
    guides: [
      {
        sourceId: "course",
        title: "Course",
        summary: "",
        complete: true,
        chapters: [
          {
            sourceId: "chapter",
            title: "Chapter",
            summary: "",
            materialIds: [],
          },
        ],
        materialIds: [],
        supplementaryMaterialIds: [],
      },
    ],
    tasks: [
      {
        sourceId: "task-one",
        productId: "course",
        chapterId: "chapter",
        title: "Authored title",
        access: null,
        publicationState: "unpublished",
        relatedMaterialIds: [],
        provenance: {
          repository: "synthetic/content",
          commit: "a".repeat(40),
          path: "practice/one.yaml",
        },
        definition: {
          schemaVersion: 2,
          format: "c",
          intro: "Intro",
          freedom: "Freedom",
          criteria: [
            {
              id: "proof",
              level: "required",
              task: "Do it",
              explanation: "Explain",
              acceptableEvidence: ["Proof"],
            },
          ],
        },
        page,
      },
    ],
  };
}
/** @param {import('node:test').TestContext} t */
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "package-v2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "package.json");
  return {
    path,
    state: join(root, "state"),
    /** @param {unknown} value */
    write: (value) => writeFile(path, canonical(value)),
  };
}

test("loadPackage preserves a task-only v2 envelope, authored definition and reader page", async (t) => {
  const f = await temporary(t);
  const manifest = fixture();
  await f.write(manifest);
  const pkg = await loadPackage(f.path);
  assert.equal(pkg.manifest.schemaVersion, 2);
  assert.deepEqual(pkg.manifest.tasks?.[0]?.page, manifest.tasks[0]?.page);
  assert.deepEqual(
    pkg.manifest.tasks?.[0]?.definition,
    manifest.tasks[0]?.definition,
  );
  assert.equal(pkg.manifest.tasks?.[0]?.access, null);
});

test("unknown features stop load, sync and preview before transport or asset reads", async (t) => {
  const f = await temporary(t);
  const manifest = fixture();
  manifest.requiredFeatures = ["quiz-v1"];
  await f.write({
    ...manifest,
    assets: [
      {
        sourceId: "absent",
        path: "nonexistent.png",
        sha256: "a".repeat(64),
        mimeType: "image/png",
      },
    ],
  });
  /** @type {string[]} */
  const calls = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path) => {
    calls.push(path);
    throw new Error("transport must not run");
  };
  await assert.rejects(loadPackage(f.path), /quiz-v1/u);
  await assert.rejects(syncLocal(f.path, f.state, { request }), /quiz-v1/u);
  await assert.rejects(
    previewRelease(f.path, f.state, {
      origin: "http://127.0.0.1:3101",
      request,
    }),
    /quiz-v1/u,
  );
  assert.deepEqual(calls, []);
});

test("null Task access is a preview decision and apply/sync never infer free", async (t) => {
  const f = await temporary(t);
  await f.write(fixture());
  /** @type {string[]} */
  const calls = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path) => {
    calls.push(path);
    if (path.endsWith("/environment")) return { mode: "development" };
    if (path.startsWith("/authoring/collections?")) return [];
    if (path === "/authoring/import/products/validate") return { valid: true };
    throw new Error(`Unexpected ${path}`);
  };
  const { path, preview } = await previewRelease(f.path, f.state, {
    origin: "http://127.0.0.1:3101",
    request,
  });
  assert.equal(preview.tasks?.[0]?.change, "conflict");
  assert.equal(preview.tasks?.[0]?.conflictReason, "task_access_decision");
  await assert.rejects(applyRelease(path, f.state, { request }), /conflicts/u);
  calls.length = 0;
  await assert.rejects(
    syncLocal(f.path, f.state, { request, defaultAccess: "free" }),
    /access.*decision/u,
  );
  assert.deepEqual(calls, []);
});

test("preview discovers Material migration without a journal and refuses sync before writes", async (t) => {
  const f = await temporary(t);
  const manifest = fixture();
  // Explicitly selected access; page snapshot keeps its original metadata.
  const task = manifest.tasks[0];
  assert.ok(task);
  const source = { ...manifest, tasks: [{ ...task, access: "closed" }] };
  await f.write(source);
  /** @type {string[]} */
  const calls = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path) => {
    calls.push(path);
    if (path.endsWith("/environment")) return { mode: "development" };
    if (path.startsWith("/authoring/collections?")) return [];
    if (path === "/authoring/import/products/validate") return { valid: true };
    if (path === "/authoring/import/tasks/validate")
      return {
        valid: true,
        current: null,
        migration: { materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      };
    throw new Error(`Unexpected ${path}`);
  };
  const { path, preview } = await previewRelease(f.path, f.state, {
    origin: "http://127.0.0.1:3101",
    request,
  });
  assert.equal(
    preview.tasks?.[0]?.conflictReason,
    "material_to_task_migration",
  );
  assert.deepEqual(preview.archiveProposals, []);
  await assert.rejects(applyRelease(path, f.state, { request }), /conflicts/u);
  calls.length = 0;
  await assert.rejects(
    syncLocal(f.path, f.state, { request }),
    /material_to_task_migration/u,
  );
  assert.deepEqual(calls, [
    "/authoring/import/materials/environment",
    "/authoring/import/products/validate",
    "/authoring/import/tasks/validate",
  ]);
});

test("task selection, missing page assets and unsupported versions fail at loadPackage", async (t) => {
  const f = await temporary(t);
  const manifest = fixture();
  await f.write({
    ...manifest,
    selection: { ...manifest.selection, taskIds: ["missing"] },
  });
  await assert.rejects(loadPackage(f.path), /Task selection/u);
  const task = manifest.tasks[0];
  assert.ok(task);
  await f.write({
    ...manifest,
    tasks: [
      { ...task, page: { ...task.page, images: { "missing.png": "absent" } } },
    ],
  });
  await assert.rejects(loadPackage(f.path), /missing asset/u);
  await f.write({ ...manifest, schemaVersion: 3 });
  await assert.rejects(loadPackage(f.path), /schemaVersion: 3/u);
});

/** @param {unknown} value */
function object(value) {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value;
}

test("applyRelease sends rendered Task pages and both source link directions without changing definition", async (t) => {
  const f = await temporary(t);
  const manifest = fixture();
  const original = manifest.tasks[0];
  const product = manifest.guides[0];
  assert.ok(original && product);
  const page = {
    ...original.page,
    sourceId: "lesson",
    sourcePath: "lesson.md",
    access: "closed",
    markdown: "[Task](tasks/one.md)",
    links: { "tasks/one.md": "task-one" },
  };
  const task = {
    ...original,
    access: null,
    afterMaterialId: "lesson",
    page: {
      ...original.page,
      markdown: "[Lesson](../lesson.md)",
      links: { "../lesson.md": "lesson" },
    },
  };
  const { afterMaterialId: _after, ...beginning } = task;
  const tasks = [
    {
      ...beginning,
      sourceId: "at-start",
      page: { ...task.page, sourceId: "at-start" },
    },
    task,
    {
      ...task,
      sourceId: "task-two",
      page: { ...task.page, sourceId: "task-two" },
    },
  ];
  await f.write({
    ...manifest,
    selection: {
      ...manifest.selection,
      materialIds: ["lesson"],
      taskIds: tasks.map((task) => task.sourceId),
    },
    materials: [page],
    tasks,
    guides: [
      {
        ...product,
        materialIds: ["lesson"],
        chapters: [{ ...product.chapters[0], materialIds: ["lesson"] }],
      },
    ],
  });
  const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const productId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  /** @type {Record<string,unknown>[]} */
  const applied = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path, body) => {
    if (path.endsWith("/environment")) return { mode: "development" };
    if (path.startsWith("/authoring/collections?")) return [];
    if (
      path === "/authoring/import/products/validate" ||
      path === "/authoring/import/materials/validate"
    )
      return { valid: true };
    if (path === "/authoring/import/tasks/validate") {
      assert.notEqual(Reflect.get(object(body), "access"), null);
      return { valid: true, current: null, migration: null };
    }
    if (path === "/authoring/import/materials/reserve")
      return { materialId, contentVersion: 1 };
    if (path === `/authoring/materials/${materialId}`)
      return {
        materialId,
        contentVersion: 1,
        primaryVideoId: null,
        source: null,
        cover: null,
        metadata: { slug: "allocated-lesson" },
        publicationState: "draft",
      };
    if (
      path === "/authoring/import/products/reserve" ||
      path === "/authoring/import/products/update"
    )
      return {
        id: productId,
        slug: "course",
        name: "Course",
        summary: "",
        version: 1,
      };
    if (path === `/authoring/products/${productId}/order`)
      return { orderVersion: "a".repeat(64), items: [], chapters: [] };
    if (path === `/authoring/products/${productId}/artifacts`)
      return { artifacts: [] };
    if (path === "/authoring/import/products/composition")
      return { orderVersion: "b".repeat(64) };
    if (path === "/authoring/import/materials/apply") {
      applied.push({ path, ...object(body) });
      return { materialId, contentVersion: 2 };
    }
    if (path === "/authoring/import/tasks/apply") {
      /** @type {unknown} */
      const code = Reflect.get(object(body), "code");
      assert.ok(typeof code === "string");
      applied.push({ path, ...object(body) });
      return {
        taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        code,
        revision: 1,
        currentVersion: 1,
        definitionDigest: "a".repeat(64),
        publicationState: "unpublished",
      };
    }
    throw new Error(`Unexpected ${path}`);
  };
  const taskAccess = ["task-two=closed", "task-one=free", "at-start=closed"];
  const reviewed = await previewRelease(f.path, f.state, {
    origin: "http://127.0.0.1:3101",
    request,
    taskAccess,
  });
  assert.deepEqual(reviewed.preview.taskAccess, [
    "at-start=closed",
    "task-one=free",
    "task-two=closed",
  ]);
  const duplicate = await previewRelease(f.path, f.state, {
    origin: "http://127.0.0.1:3101",
    request,
    taskAccess: [...taskAccess, "task-one=free"],
  });
  assert.equal(duplicate.preview.fingerprint, reviewed.preview.fingerprint);
  const closed = await previewRelease(f.path, f.state, {
    origin: "http://127.0.0.1:3101",
    request,
    taskAccess: ["at-start=closed", "task-one=closed", "task-two=closed"],
  });
  assert.notEqual(closed.preview.fingerprint, reviewed.preview.fingerprint);
  const report = await applyRelease(reviewed.path, f.state, { request });
  assert.equal(report.tasks?.[0]?.change, "new");
  const appliedTask = applied.find(
    (row) =>
      row["path"] === "/authoring/import/tasks/apply" &&
      row["code"] === "task-one",
  );
  const appliedMaterial = applied.find(
    (row) => row["path"] === "/authoring/import/materials/apply",
  );
  assert.ok(appliedTask && appliedMaterial);
  assert.equal(appliedTask["access"], "free");
  assert.equal((await loadPackage(f.path)).manifest.tasks?.[1]?.access, null);
  assert.deepEqual(appliedTask["definition"], original.definition);
  assert.deepEqual(appliedTask["page"], task.page);
  assert.deepEqual(appliedTask["resolvedLinks"], {
    "../lesson.md": "synthetic:lesson",
  });
  assert.ok(
    canonical(appliedTask["pageBody"]).includes("/materials/allocated-lesson"),
  );
  assert.ok(
    canonical(appliedMaterial["body"]).includes(
      "/products/course/tasks/task-one",
    ),
  );
  assert.equal(appliedTask["afterMaterialSourceId"], "synthetic:lesson");
  assert.equal(appliedTask["position"], 2);
  assert.deepEqual(
    applied
      .filter((row) => row["path"] === "/authoring/import/tasks/apply")
      .map((row) => [
        row["code"],
        row["position"],
        row["afterMaterialSourceId"],
      ]),
    [
      ["at-start", 1, undefined],
      ["task-one", 2, "synthetic:lesson"],
      ["task-two", 3, "synthetic:lesson"],
    ],
  );
});

test("Task page images, cover and artifacts stay on a distinct private backing Material", async (t) => {
  const f = await temporary(t);
  const manifest = fixture();
  const original = manifest.tasks[0];
  assert.ok(original);
  const { checksum } = await import("./package.mjs");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const file = Buffer.from("Synthetic artifact");
  await writeFile(join(f.path, "..", "image.png"), png);
  await writeFile(join(f.path, "..", "artifact.txt"), file);
  const task = {
    ...original,
    access: "closed",
    page: {
      ...original.page,
      markdown: "![Diagram](diagram.png)",
      images: { "diagram.png": "picture" },
      coverAssetId: "picture",
      coverAlt: "Cover",
      artifacts: [
        { sourceId: "download", title: "Artifact", assetId: "document" },
      ],
    },
  };
  await f.write({
    ...manifest,
    tasks: [task],
    assets: [
      {
        sourceId: "picture",
        path: "image.png",
        sha256: checksum(png),
        mimeType: "image/png",
      },
      {
        sourceId: "document",
        path: "artifact.txt",
        sha256: checksum(file),
        mimeType: "text/plain",
      },
    ],
  });
  const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const productId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const imageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const fileId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  /** @type {Record<string,unknown>[]} */
  const commands = [];
  /** @type {string[]} */
  const uploadKinds = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path, body) => {
    if (path.endsWith("/environment")) return { mode: "development" };
    if (path.startsWith("/authoring/collections?")) return [];
    if (path === "/authoring/import/products/validate") return { valid: true };
    if (path === "/authoring/import/tasks/validate")
      return { valid: true, current: null, migration: null };
    if (
      path === "/authoring/import/products/reserve" ||
      path === "/authoring/import/products/update"
    )
      return {
        id: productId,
        slug: "course",
        name: "Course",
        summary: "",
        version: 1,
      };
    if (path === `/authoring/products/${productId}/order`)
      return { orderVersion: "a".repeat(64), items: [], chapters: [] };
    if (path === "/authoring/import/products/composition")
      return { orderVersion: "b".repeat(64) };
    if (path === `/authoring/products/${productId}/artifacts`)
      return { artifacts: [] };
    if (path === "/authoring/import/materials/reserve") {
      commands.push({ path, ...object(body) });
      return { materialId, contentVersion: 1 };
    }
    if (path === `/authoring/materials/${materialId}`)
      return {
        materialId,
        contentVersion: 1,
        primaryVideoId: null,
        source: null,
        metadata: { slug: "hidden", access: "closed" },
        publicationState: "draft",
      };
    if (path === `/authoring/materials/${materialId}/assets`) {
      assert.ok(body instanceof FormData);
      const kind = body.get("kind");
      assert.ok(typeof kind === "string");
      uploadKinds.push(kind);
      return { assetId: kind === "image" ? imageId : fileId };
    }
    if (path === "/authoring/import/materials/apply") {
      commands.push({ path, ...object(body) });
      return { materialId, contentVersion: 2 };
    }
    if (path === "/authoring/import/tasks/apply") {
      commands.push({ path, ...object(body) });
      return {
        taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        code: "task-one",
        revision: 1,
        currentVersion: 1,
        definitionDigest: "a".repeat(64),
        publicationState: "unpublished",
      };
    }
    throw new Error(`Unexpected ${path}`);
  };
  await syncLocal(f.path, f.state, { request });
  assert.deepEqual(uploadKinds, ["image", "file"]);
  const reserve = commands.find(
    (row) => row["path"] === "/authoring/import/materials/reserve",
  );
  const backing = commands.find(
    (row) => row["path"] === "/authoring/import/materials/apply",
  );
  const applied = commands.find(
    (row) => row["path"] === "/authoring/import/tasks/apply",
  );
  assert.ok(reserve && backing && applied);
  assert.equal(
    Reflect.get(object(reserve["source"]), "id"),
    "inside-task-page:synthetic:task-one",
  );
  assert.equal(Reflect.get(object(reserve["source"]), "showInFeed"), false);
  assert.equal(backing["publicationState"], "draft");
  assert.equal(Reflect.get(object(backing["metadata"]), "access"), "closed");
  assert.deepEqual(Reflect.get(object(backing["metadata"]), "seriesIds"), []);
  assert.ok(canonical(backing["body"]).includes("assetFile"));
  assert.ok(canonical(backing["body"]).includes(imageId));
  assert.deepEqual(applied["resolvedImages"], {
    "diagram.png": { assetId: imageId, materialId },
    "cover:picture": { assetId: imageId, materialId },
    "artifact:download": { assetId: fileId, materialId },
  });
  assert.deepEqual(applied["page"], task.page);
  assert.ok(canonical(applied["pageBody"]).includes(imageId));
  assert.equal(commands.at(-1)?.["path"], "/authoring/import/tasks/apply");
});

test("preview rejects unknown Task codes and conflicting access choices before transport", async (t) => {
  const f = await temporary(t);
  await f.write(fixture());
  /** @type {string[]} */
  const calls = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path) => {
    calls.push(path);
    throw new Error("transport must not run");
  };
  await assert.rejects(
    previewRelease(f.path, f.state, {
      origin: "http://127.0.0.1:3101",
      request,
      taskAccess: ["absent=free"],
    }),
    /Unknown Task access code: absent/u,
  );
  await assert.rejects(
    previewRelease(f.path, f.state, {
      origin: "http://127.0.0.1:3101",
      request,
      taskAccess: ["task-one=free", "task-one=closed"],
    }),
    /Conflicting Task access choices/u,
  );
  await assert.rejects(
    previewRelease(f.path, f.state, {
      origin: "http://127.0.0.1:3101",
      request,
      taskAccess: ["task-one=workshop"],
    }),
    /free or closed/u,
  );
  assert.deepEqual(calls, []);
});

test("an interrupted Task apply cannot replay under a different reviewed access choice", async (t) => {
  const f = await temporary(t);
  const manifest = fixture();
  const task = manifest.tasks[0];
  assert.ok(task);
  await f.write(manifest);
  const { withJournal, applyJournaled } = await import("./journal.mjs");
  const { authoringTarget } = await import("./target.mjs");
  const target = authoringTarget("http://127.0.0.1:3101");
  const operation = {
    path: "/authoring/import/tasks/apply",
    body: {
      code: task.sourceId,
      sourceId: "synthetic:task-one",
      access: "closed",
      title: task.title,
      definition: task.definition,
      page: task.page,
      publicationState: "unpublished",
      provenance: task.provenance,
    },
  };
  await assert.rejects(
    withJournal(f.state, target.id, (context) =>
      applyJournaled(context, operation, async () => {
        throw new Error("Lost response");
      }),
    ),
    /Lost response/u,
  );
  /** @type {string[]} */
  const writes = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path) => {
    if (path.endsWith("/environment")) return { mode: "development" };
    if (path === "/authoring/import/tasks/validate")
      return { valid: true, current: null, migration: null };
    writes.push(path);
    throw new Error(`Unexpected write ${path}`);
  };
  await assert.rejects(
    syncLocal(f.path, f.state, {
      request,
      origin: target.id,
      reviewed: true,
      reconcileOnly: true,
      reviewedTaskAccess: ["task-one=free"],
    }),
    /different access decision/u,
  );
  assert.deepEqual(writes, []);
});
