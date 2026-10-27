// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, checksum } from "./package.mjs";
import { applyJournaled, withJournal } from "./journal.mjs";
import { syncLocal, reviewOrigin } from "./local-sync.mjs";
import { replayPracticeImports } from "./practice-import.mjs";
import { parseJournal, parseLocalResponse } from "./local-boundaries.mjs";
import { currentEnvironment } from "./test-support.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourceReference = {
  materialSourceId: "synthetic:lesson",
  materialSourceRevision: "a".repeat(64),
};
const provenance = {
  repository: "synthetic/fixture",
  commit: "b".repeat(40),
  path: "original.json",
};
/** @type {readonly (number | 'transport' | 'unbound-404')[]} */
const failures = [403, 400, 409, 422, 401, "transport", "unbound-404"];

for (const kind of /** @type {const} */ (["Material", "Practice"])) {
  for (const failure of failures) {
    test(`${kind} receipt lookup ${failure} preserves unknown outcome until the original key succeeds`, async (t) => {
      const directory = await mkdtemp(
        join(tmpdir(), "historical-lookup-failure-"),
      );
      t.after(() => rm(directory, { recursive: true, force: true }));
      const packagePath = join(directory, "package.json");
      const state = join(directory, "state");
      await writeFile(
        packagePath,
        canonical({
          schemaVersion: 3,
          requiredFeatures: ["canonical-product-source-v2"],
          sourceNamespace: "synthetic",
          selection: {
            productId: null,
            chapterIds: [],
            materialIds: ["lesson"],
            taskIds: [],
            complete: true,
          },
          materials: [
            {
              sourceId: "lesson",
              sourcePath: "lesson.md",
              sourceIds: [],
              relatedMaterialIds: [],
              readingTimeMinutes: null,
              kind: "guide",
              title: "Lesson",
              summary: "Summary",
              stage: "draft",
              topicId: null,
              access: "closed",
              difficulty: null,
              outcomes: [],
              markdown: "Original",
              links: {},
              images: {},
              coverAssetId: null,
              coverAlt: null,
              video: null,
              videoChapters: [],
              artifacts: [],
            },
          ],
          products: [],
          assets: [],
          diagnostics: [],
        }),
      );
      const original =
        kind === "Material"
          ? {
              path: "/authoring/import/materials/apply",
              body: {
                source: {
                  id: "synthetic:lesson",
                  path: "lesson.md",
                  revision: "a".repeat(64),
                  showInFeed: false,
                },
                materialId,
                expectedContentVersion: 7,
                publicationState: "draft",
                primaryVideoId: null,
                metadata: {
                  title: "Lesson",
                  summary: "Summary",
                  access: "membership",
                  difficulty: null,
                  outcomes: [],
                  topicId: null,
                  formatId: "guide",
                  tagIds: [],
                  seriesIds: [],
                },
                body: { schemaVersion: 1, doc: { type: "doc", content: [] } },
              },
            }
          : {
              path: "/authoring/import/practices/apply",
              body: {
                practiceId: "synthetic:brief",
                definition: { schemaVersion: 1, title: "Original" },
                sourceReference,
                provenance,
                publicationState: "unpublished",
                materialId,
                expectedContentVersion: 7,
                expectedPracticeVersion: null,
              },
            };
      const receipt =
        kind === "Material"
          ? { materialId, contentVersion: 8 }
          : {
              practiceId: "synthetic:brief",
              practiceVersion: 19,
              definitionDigest: "c".repeat(64),
              materialId,
              boundContentVersion: 7,
              publicationState: "unpublished",
            };
      const key = `authoring:${checksum(canonical(original))}`;
      await withJournal(state, reviewOrigin, async ({ journal, persist }) => {
        journal.operations[key] = {
          status: "pending",
          request: structuredClone(original),
        };
        await persist();
      });
      assert.equal(
        "actor" in original,
        false,
        "the historical pending request cannot bind the original login actor",
      );
      let lookups = 0;
      /** @type {import('./local-boundaries.mjs').LocalRequest} */
      const request = async (path, body, sentKey) => {
        if (path === "/authoring/import/materials/environment")
          return parseLocalResponse(path, currentEnvironment("development"));
        assert.equal(
          path,
          kind === "Material"
            ? "/authoring/history/material-receipts"
            : "/authoring/history/practice-receipts",
        );
        assert.equal(sentKey, key);
        assert.deepEqual(body, original.body);
        lookups++;
        if (lookups === 1) {
          if (failure === "transport")
            throw new TypeError("Lookup transport failed");
          throw Object.assign(new Error("Lookup refused"), {
            status: failure === "unbound-404" ? 404 : failure,
            body: {
              code:
                failure === "unbound-404"
                  ? "historical_receipt_not_found"
                  : "lookup_failed",
            },
          });
        }
        return parseLocalResponse(path, receipt);
      };
      const resume = () =>
        kind === "Material"
          ? syncLocal(packagePath, state, { reconcileOnly: true, request })
          : withJournal(state, reviewOrigin, (context) =>
              replayPracticeImports(context, request, () => "draft"),
            );
      await assert.rejects(resume());
      assert.equal(lookups, 1, "the failure came from the receipt lookup");
      const pending = parseJournal(
        JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
      );
      assert.deepEqual(pending.operations[key], {
        status: "pending",
        request: original,
      });
      await resume();
      await resume();
      const saved = parseJournal(
        JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
      );
      assert.deepEqual(saved.operations[key], {
        status: "applied",
        request: original,
        result: receipt,
      });
      assert.deepEqual(Object.keys(saved.operations), [key]);
      assert.equal(
        lookups,
        2,
        "only the original-key lookup repeats; no mutation is dispatched",
      );
    });
  }
}

test("a current mutation 403 remains a definitive rejection in the generic journal", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "current-mutation-rejection-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = {
    path: "/authoring/import/tasks/apply",
    body: { code: "current-task", access: "closed" },
  };
  const key = `authoring:${checksum(canonical(original))}`;
  await assert.rejects(
    withJournal(directory, reviewOrigin, (context) =>
      applyJournaled(context, original, async (request, sentKey) => {
        assert.equal(sentKey, key);
        assert.deepEqual(request, original);
        throw Object.assign(new Error("Current mutation forbidden"), {
          status: 403,
        });
      }),
    ),
    /Current mutation forbidden/u,
  );
  const journal = parseJournal(
    JSON.parse(await readFile(join(directory, "journal.json"), "utf8")),
  );
  assert.deepEqual(journal.operations[key], {
    status: "rejected",
    request: original,
    error: { status: 403, message: "Current mutation forbidden" },
  });
});
