// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { withJournal } from "./journal.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";
import { publicationPolicy } from "./local-sync.mjs";
import { sourceUuid } from "./markdown.mjs";
import { canonical, checksum, loadPackage } from "./package.mjs";
import {
  previewTasks,
  replayTaskImports,
  syncSourceTasks,
  validateSourceTasks,
} from "./task-import.mjs";

const guideUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** @param {string} sourceId @param {Partial<import('./package.mjs').ManifestTask>} [overrides] */
const task = (sourceId, overrides = {}) => ({
  sourceId,
  guideId: "course",
  chapterId: "chapter-one",
  title: `Задание ${sourceId}`,
  access: /** @type {const} */ ("free"),
  definition: { schemaVersion: 1, situation: sourceId },
  relatedMaterialIds: ["review"],
  publicationState: /** @type {const} */ ("published"),
  provenance: {
    repository: "synthetic/content",
    commit: "b".repeat(40),
    path: `tasks/${sourceId}.yaml`,
  },
  ...overrides,
});

/** @param {import('./package.mjs').ManifestTask[]} tasks @returns {import('./package.mjs').Manifest} */
const manifestOf = (tasks) => ({
  schemaVersion: 1,
  sourceNamespace: "synthetic",
  selection: {
    guideId: "course",
    chapterIds: [],
    materialIds: ["review"],
    complete: true,
  },
  materials: [
    {
      sourceId: "review",
      sourcePath: "review.md",
      sourceIds: [],
      relatedMaterialIds: [],
      readingTimeMinutes: null,
      kind: "guide",
      title: "Разбор",
      summary: "Разбор",
      stage: "published",
      topicId: null,
      access: "free",
      showInFeed: false,
      difficulty: null,
      outcomes: null,
      markdown: "Разбор",
      links: {},
      images: {},
      coverAssetId: null,
      coverAlt: null,
      video: null,
      videoChapters: [],
      artifacts: [],
    },
  ],
  guides: [
    {
      sourceId: "course",
      title: "Курс",
      summary: "",
      complete: true,
      chapters: [
        {
          sourceId: "chapter-one",
          title: "Глава 1",
          summary: "",
          materialIds: ["review"],
        },
        {
          sourceId: "chapter-two",
          title: "Глава 2",
          summary: "",
          materialIds: [],
        },
      ],
      materialIds: ["review"],
      supplementaryMaterialIds: [],
    },
  ],
  assets: [],
  diagnostics: [],
  tasks,
});

const applySchema = z
  .object({
    sourceId: z.string(),
    code: z.string(),
    guideId: z.uuid(),
    chapterId: z.uuid(),
    position: z.number().int().positive(),
    title: z.string(),
    access: z.enum(["free", "membership"]),
    definition: z.record(z.string(), z.json()),
    relatedMaterialSourceIds: z.array(z.string()),
    publicationState: z.enum(["published", "unpublished"]),
    provenance: z.object({}).passthrough(),
    expectedRevision: z.number().int().positive().nullable(),
  })
  .strict();

/** A stand-in for the backend import: a changed state raises the revision. */
async function fixture(/** @type {import('node:test').TestContext} */ t) {
  const root = await mkdtemp(join(tmpdir(), "task-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  /** @type {Map<string, { receipt: z.infer<typeof import('./local-boundaries.mjs').taskReceiptSchema>; state: string }>} */
  const tasks = new Map();
  /** @type {Map<string, unknown>} */
  const receipts = new Map();
  /** @type {z.infer<typeof applySchema>[]} */
  const applied = [];
  let lose = false;
  /** @type {import('./target.mjs').LocalTransport} */
  const transport = async (path, body, key) => {
    const code = z.object({ code: z.string() }).passthrough().parse(body).code;
    if (path.endsWith("/validate"))
      return { valid: true, current: tasks.get(code)?.receipt ?? null };
    assert.ok(key);
    if (receipts.has(key)) return receipts.get(key);
    const command = applySchema.parse(body);
    const current = tasks.get(code);
    assert.equal(command.expectedRevision, current?.receipt.revision ?? null);
    applied.push(command);
    const {
      expectedRevision: _cas,
      provenance: _provenance,
      ...state
    } = command;
    const changed = current?.state !== canonical(state);
    const receipt = {
      taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      code,
      revision: (current?.receipt.revision ?? 0) + (changed ? 1 : 0),
      currentVersion: 1,
      definitionDigest: checksum(canonical(command.definition)),
      publicationState: command.publicationState,
    };
    tasks.set(code, { receipt, state: canonical(state) });
    receipts.set(key, receipt);
    if (lose) {
      lose = false;
      throw new Error("response lost after commit");
    }
    return receipt;
  };
  /** @type {import('./local-boundaries.mjs').LocalRequest} */
  const request = async (path, body, key) =>
    parseLocalResponse(path, await transport(path, body, key));
  /** @param {(context: import('./journal.mjs').JournalContext) => Promise<unknown>} action */
  const journal = (action) =>
    withJournal(root, "http://127.0.0.1:12345", async (context) => {
      await action(context);
    });
  return {
    request,
    journal,
    applied,
    tasks,
    loseNext: () => {
      lose = true;
    },
  };
}

/** @param {boolean} value */
const selection = (value) => ({
  guideIdOf: () => guideUuid,
  selected: () => value,
});

test("a task lands in its chapter by the package order and repeats nothing unchanged", async (t) => {
  const f = await fixture(t);
  const manifest = manifestOf([
    task("first"),
    task("other-chapter", { chapterId: "chapter-two" }),
    task("second"),
  ]);
  await validateSourceTasks(manifest, f.request);
  const changes = await f.journal((c) =>
    syncSourceTasks(manifest, c, f.request, selection(true)),
  );
  void changes;
  assert.deepEqual(
    f.applied.map((body) => [body.code, body.position, body.chapterId]),
    [
      ["first", 1, sourceUuid("synthetic:course:chapter:chapter-one")],
      ["other-chapter", 1, sourceUuid("synthetic:course:chapter:chapter-two")],
      ["second", 2, sourceUuid("synthetic:course:chapter:chapter-one")],
    ],
  );
  assert.equal(f.applied[0]?.guideId, guideUuid);
  assert.equal(f.applied[0]?.sourceId, "synthetic:first");
  assert.deepEqual(f.applied[0]?.relatedMaterialSourceIds, [
    "synthetic:review",
  ]);
  await f.journal((c) =>
    syncSourceTasks(manifest, c, f.request, selection(true)),
  );
  assert.equal(f.applied.length, 3);
  // A task the package omits stays as the target holds it.
  await f.journal((c) =>
    syncSourceTasks(manifestOf([]), c, f.request, selection(true)),
  );
  assert.equal(f.applied.length, 3);
});

test("only an explicit selection publishes; Content's unpublished withdraws; no selection keeps the target", async (t) => {
  const f = await fixture(t);
  const manifest = manifestOf([task("lesson-task")]);
  await f.journal((c) =>
    syncSourceTasks(manifest, c, f.request, selection(false)),
  );
  assert.equal(f.applied.at(-1)?.publicationState, "unpublished");
  await f.journal((c) =>
    syncSourceTasks(manifest, c, f.request, selection(true)),
  );
  assert.equal(f.applied.at(-1)?.publicationState, "published");
  const count = f.applied.length;
  await f.journal((c) =>
    syncSourceTasks(manifest, c, f.request, selection(false)),
  );
  assert.equal(f.applied.length, count, "no selection never unpublishes");
  await f.journal((c) =>
    syncSourceTasks(
      manifestOf([task("lesson-task", { publicationState: "unpublished" })]),
      c,
      f.request,
      selection(true),
    ),
  );
  assert.equal(f.applied.at(-1)?.publicationState, "unpublished");
});

test("a lost answer is completed with its key, a publication needs the same approval, and a foreign change stops the transfer", async (t) => {
  const f = await fixture(t);
  const manifest = manifestOf([task("recover")]);
  f.loseNext();
  await assert.rejects(
    f.journal((c) => syncSourceTasks(manifest, c, f.request, selection(true))),
    /response lost/u,
  );
  await assert.rejects(
    f.journal((c) => replayTaskImports(c, f.request, () => false)),
    /interrupted transfer was publishing this task/u,
  );
  await f.journal(async (c) => {
    await replayTaskImports(c, f.request, () => true);
    await syncSourceTasks(manifest, c, f.request, selection(true));
  });
  // The replay committed once; the next comparison resends the same state and changes nothing.
  const stored = f.tasks.get("recover");
  assert.ok(stored);
  assert.equal(stored.receipt.revision, 1);
  f.tasks.set("recover", {
    ...stored,
    receipt: { ...stored.receipt, revision: stored.receipt.revision + 1 },
  });
  await assert.rejects(
    f.journal((c) =>
      syncSourceTasks(
        manifestOf([task("recover", { title: "Новое" })]),
        c,
        f.request,
        selection(true),
      ),
    ),
    /changed on the target/u,
  );
});

test("a release preview lists new, unchanged and conflicting tasks without a write", async (t) => {
  const f = await fixture(t);
  const manifest = manifestOf([task("kept"), task("fresh")]);
  await f.journal((c) =>
    syncSourceTasks(manifestOf([task("kept")]), c, f.request, selection(true)),
  );
  const writes = f.applied.length;
  await f.journal(async (c) => {
    const preview = await previewTasks(
      manifest,
      c.journal,
      f.request,
      () => true,
    );
    assert.deepEqual(
      preview.tasks.map((item) => [item.sourceId, item.change]),
      [
        ["kept", "unchanged"],
        ["fresh", "new"],
      ],
    );
    assert.deepEqual(preview.expected, { "task:kept": 1, "task:fresh": 0 });
  });
  assert.equal(f.applied.length, writes);
  const stored = f.tasks.get("kept");
  assert.ok(stored);
  f.tasks.set("kept", {
    ...stored,
    receipt: { ...stored.receipt, revision: 5 },
  });
  await f.journal(async (c) => {
    const preview = await previewTasks(
      manifest,
      c.journal,
      f.request,
      () => true,
    );
    assert.equal(preview.tasks[0]?.change, "conflict");
  });
});

test("a package names each task's Guide and chapter, keeps codes apart from Materials, and --publish accepts a code", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "task-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  /** @param {import('./package.mjs').Manifest} manifest */
  const load = async (manifest) => {
    const path = join(root, `${checksum(canonical(manifest))}.json`);
    await writeFile(path, canonical(manifest));
    return loadPackage(path);
  };
  assert.equal(
    (await load(manifestOf([task("valid")]))).manifest.tasks?.length,
    1,
  );
  await assert.rejects(
    load(manifestOf([task("lost", { guideId: "absent" })])),
    /Guide is not in the package/u,
  );
  await assert.rejects(
    load(manifestOf([task("lost", { chapterId: "absent" })])),
    /chapter is not in its Guide/u,
  );
  await assert.rejects(
    load(manifestOf([task("review")])),
    /repeats a Material identity/u,
  );
  const policy = publicationPolicy(manifestOf([task("valid")]), ["valid"]);
  assert.equal(policy("synthetic:valid"), "published");
  assert.equal(policy("synthetic:review"), "draft");
  assert.throws(
    () => publicationPolicy(manifestOf([task("valid")]), ["absent"]),
    /outside this package/u,
  );
});
