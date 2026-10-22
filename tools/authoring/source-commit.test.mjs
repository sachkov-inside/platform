// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonical, loadPackage } from "./package.mjs";
import { sourceCommitRelation, verifyPackageSource } from "./source-commit.mjs";

test("a package moves a row forward along Content history, never back or sideways", async () => {
  // History: a ← b ← c, and x on another branch from a.
  /** @type {Record<string, string[]>} */
  const parents = { a: [], b: ["a"], c: ["b", "a"], x: ["a"] };
  const isAncestor = async (
    /** @type {string} */ ancestor,
    /** @type {string} */ descendant,
  ) =>
    ancestor === descendant || (parents[descendant] ?? []).includes(ancestor);
  assert.equal(await sourceCommitRelation(null, "c", isAncestor), "unrecorded");
  assert.equal(
    await sourceCommitRelation(undefined, "c", isAncestor),
    "unrecorded",
  );
  assert.equal(await sourceCommitRelation("c", "c", isAncestor), "same");
  assert.equal(await sourceCommitRelation("b", "c", isAncestor), "forward");
  assert.equal(await sourceCommitRelation("c", "b", isAncestor), "older");
  assert.equal(await sourceCommitRelation("x", "c", isAncestor), "diverged");
});

test("a later unrelated commit does not block a package with Tasks; a changed Task does", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "source-commit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const older = "a".repeat(40);
  const newer = "b".repeat(40);
  /** @param {string} commit @param {string} criteria */
  const write = async (commit, criteria) => {
    /** @type {import("./package.mjs").Manifest["materials"][number]} */
    const lesson = {
      sourceId: "one",
      sourcePath: "one.md",
      sourceIds: [],
      relatedMaterialIds: [],
      readingTimeMinutes: null,
      kind: "note",
      title: "One",
      summary: "Summary",
      stage: "draft",
      topicId: null,
      access: "free",
      showInFeed: false,
      difficulty: null,
      outcomes: [],
      markdown: "Lesson",
      links: {},
      images: {},
      coverAssetId: null,
      coverAlt: null,
      video: null,
      videoChapters: [],
      artifacts: [],
    };
    /** @type {import("./package.mjs").Manifest} */
    const manifest = {
      schemaVersion: 2,
      requiredFeatures: ["bounded-content-v1"],
      sourceNamespace: "synthetic",
      selection: {
        productId: "course",
        chapterIds: [],
        materialIds: ["one"],
        taskIds: ["task"],
        contentOnly: {
          materialIds: ["one"],
          taskIds: ["task"],
          artifactIds: [],
        },
        complete: true,
      },
      materials: [lesson],
      tasks: [
        {
          sourceId: "task",
          productId: "course",
          chapterId: "chapter",
          title: "Task",
          access: "closed",
          definition: { intro: criteria },
          page: {
            ...lesson,
            sourceId: "task",
            sourcePath: "task.md",
            markdown: "Task page",
          },
          relatedMaterialIds: [],
          publicationState: "published",
          provenance: {
            repository: "synthetic/content",
            commit,
            path: "task.yaml",
          },
        },
      ],
      products: [
        {
          sourceId: "course",
          slug: "course",
          title: "Course",
          summary: "",
          complete: true,
          materialIds: ["one"],
          supplementaryMaterialIds: [],
          chapters: [
            {
              sourceId: "chapter",
              title: "Chapter",
              summary: "",
              materialIds: ["one"],
            },
          ],
        },
      ],
      assets: [],
      diagnostics: [],
    };
    const path = join(directory, `${commit}-${criteria}.json`);
    await writeFile(path, canonical(manifest));
    return path;
  };
  const delivered = await write(older, "Criteria");
  /** @type {Record<string, string>} */
  const exports = {
    [older]: delivered,
    [newer]: await write(newer, "Criteria"),
  };
  const options = {
    repository: directory,
    commit: older,
    stateDirectory: directory,
    exportPackage: /** @type {import("./source-commit.mjs").ExportPackage} */ (
      async (_repository, _guide, _state, ref) => ({
        commit: ref,
        packagePath: exports[ref] ?? "",
      })
    ),
    resolveHead: async () => newer,
  };
  const pkg = await loadPackage(delivered);
  assert.deepEqual(await verifyPackageSource(pkg, options), { head: newer });
  exports[newer] = await write(newer, "Changed criteria");
  await assert.rejects(verifyPackageSource(pkg, options), /task:task/u);
});
