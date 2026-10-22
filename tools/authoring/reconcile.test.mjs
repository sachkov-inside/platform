// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseJournal } from "./local-boundaries.mjs";
import { archiveProposalKeys } from "./local-sync.mjs";
import { reconcileJournal } from "./reconcile.mjs";
import { authoringTarget } from "./target.mjs";

const productId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("an adopted Material names its Products, so another Product's release never proposes archiving it", async (t) => {
  const state = await mkdtemp(join(tmpdir(), "reconcile-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  /** @type {import("./target.mjs").LocalTransport} */
  const send = async (path) => {
    if (path === "/authoring/collections?kind=product")
      return [
        {
          id: productId,
          slug: "course",
          name: "Course",
          summary: "",
          version: 1,
          sourceId: "synthetic:course",
        },
      ];
    if (path === "/authoring/import/tasks/state?namespace=synthetic")
      return { namespace: "synthetic", tasks: [] };
    if (path === "/authoring/import/materials/state?namespace=synthetic")
      return {
        namespace: "synthetic",
        materials: [
          {
            sourceId: "synthetic:lesson",
            materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            slug: null,
            contentVersion: 3,
            access: "closed",
            publicationState: "published",
            source: {
              path: "lesson.md",
              revision: "b".repeat(64),
              commit: null,
              showInFeed: false,
            },
            memberships: [{ productId, ordinal: 1, chapterId: null }],
          },
        ],
      };
    throw new Error(`Unexpected ${path}`);
  };
  const report = await reconcileJournal(state, {
    target: authoringTarget("production"),
    send,
    namespace: "synthetic",
    adopt: ["lesson"],
  });
  assert.deepEqual(report.adopted, ["synthetic:lesson"]);
  const journal = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  const entry = journal.materials["synthetic:lesson"];
  assert.deepEqual(entry?.productSourceIds, ["synthetic:course"]);
  assert.equal(
    entry?.url,
    undefined,
    "a Material without a slug gets no invented Reader path",
  );
  /** @type {import("./package.mjs").Manifest} */
  const other = {
    schemaVersion: 2,
    requiredFeatures: [],
    sourceNamespace: "synthetic",
    selection: {
      productId: "other",
      chapterIds: [],
      materialIds: [],
      taskIds: [],
      complete: true,
    },
    materials: [],
    products: [
      {
        sourceId: "other",
        title: "Other",
        summary: "",
        complete: true,
        chapters: [],
        materialIds: [],
        supplementaryMaterialIds: [],
      },
    ],
    assets: [],
    diagnostics: [],
  };
  assert.deepEqual(archiveProposalKeys(journal, other), []);
});

test("a Task revised through another journal is reported, and adoption records the target revision", async (t) => {
  const state = await mkdtemp(join(tmpdir(), "reconcile-task-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  const target = authoringTarget("production");
  await writeFile(
    join(state, "journal.json"),
    JSON.stringify({
      schemaVersion: 1,
      target: target.id,
      materials: {},
      products: {},
      operations: {},
      resources: { "task:aie-task": { revision: 2, digest: "d".repeat(64) } },
    }),
  );
  /** @type {import("./target.mjs").LocalTransport} */
  const send = async (path) => {
    if (path === "/authoring/collections?kind=product") return [];
    if (path === "/authoring/import/materials/state?namespace=synthetic")
      return { namespace: "synthetic", materials: [] };
    if (path === "/authoring/import/tasks/state?namespace=synthetic")
      return {
        namespace: "synthetic",
        tasks: [
          {
            sourceId: "synthetic:aie-task",
            taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            code: "aie-task",
            productId,
            chapterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            position: 1,
            afterMaterialSourceId: null,
            programmeVisibility: "standalone",
            embeddedMaterialId: null,
            revision: 3,
            access: "closed",
            publicationState: "published",
            sourceCommit: "a".repeat(40),
          },
        ],
      };
    throw new Error(`Unexpected ${path}`);
  };
  const before = await reconcileJournal(state, {
    target,
    send,
    namespace: "synthetic",
  });
  assert.deepEqual(before.taskCounts, {
    agree: 0,
    target_only: 0,
    version_differs: 1,
  });
  const after = await reconcileJournal(state, {
    target,
    send,
    namespace: "synthetic",
    adopt: ["aie-task"],
  });
  assert.deepEqual(after.adopted, ["synthetic:aie-task"]);
  assert.deepEqual(after.taskCounts, {
    agree: 1,
    target_only: 0,
    version_differs: 0,
  });
  const journal = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  assert.deepEqual(Object.keys(journal.resources ?? {}).sort(), [
    "adopted:synthetic:aie-task",
    "task:aie-task",
  ]);
  assert.match(
    JSON.stringify(journal.resources?.["task:aie-task"]),
    /"revision":3/u,
  );
});
