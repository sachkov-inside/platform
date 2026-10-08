// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { withJournal } from "./journal.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";
import {
  replayPracticeImports,
  syncSourcePractices,
  validateSourcePractices,
} from "./practice-import.mjs";
import { sourcePracticeSchema } from "./package.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const definition = sourcePracticeSchema.parse({
  practiceId: "synthetic:brief",
  definition: { schemaVersion: 1, title: "Brief" },
  sourceReference: {
    materialSourceId: "synthetic:lesson",
    materialSourceRevision: "a".repeat(64),
  },
  provenance: {
    repository: "synthetic/fixture",
    commit: "b".repeat(40),
    path: "brief.json",
  },
  publicationState: "published",
});
/** @type {import('./package.mjs').Manifest} */
const manifest = {
  schemaVersion: 1,
  sourceNamespace: "synthetic",
  selection: {
    productId: null,
    chapterIds: [],
    materialIds: ["lesson"],
    complete: true,
  },
  materials: [],
  products: [],
  assets: [],
  diagnostics: [],
  practiceDefinitions: [definition],
};
const bodySchema = sourcePracticeSchema.extend({
  materialId: z.uuid(),
  expectedContentVersion: z.number(),
  expectedPracticeVersion: z.number().nullable(),
});

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "practice-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  /** @type {z.infer<typeof import("./local-boundaries.mjs").practiceReceiptSchema> | null} */
  let current = null;
  let lose = false;
  let calls = 0;
  /** @type {Map<string, z.infer<typeof import("./local-boundaries.mjs").practiceReceiptSchema>>} */
  const receipts = new Map();
  /** @type {import('./target.mjs').LocalTransport} */
  const transport = async (path, body, key) => {
    if (path.endsWith("/validate")) return { valid: true, current };
    const command = bodySchema.parse(body);
    assert.ok(key);
    const replay = receipts.get(key);
    if (replay) return replay;
    assert.equal(
      command.expectedPracticeVersion,
      current?.practiceVersion ?? null,
    );
    calls++;
    current = {
      practiceId: command.practiceId,
      materialId,
      boundContentVersion: 1,
      definitionDigest: "c".repeat(64),
      practiceVersion: (current?.practiceVersion ?? 0) + 1,
      publicationState: command.publicationState,
    };
    receipts.set(key, structuredClone(current));
    if (lose) {
      lose = false;
      throw new Error("response lost after commit");
    }
    return current;
  };
  /** @type {import('./local-boundaries.mjs').LocalRequest} */
  const request = async (path, body, key) =>
    parseLocalResponse(path, await transport(path, body, key));
  /** @param {(context: import('./journal.mjs').JournalContext) => Promise<void>} action */
  const journal = (action) =>
    withJournal(root, "http://127.0.0.1:12345", async (context) => {
      context.journal.materials["synthetic:lesson"] = {
        materialId,
        contentVersion: 1,
        revision: "a".repeat(64),
        digest: "a".repeat(64),
      };
      await action(context);
    });
  return {
    request,
    journal,
    calls: () => calls,
    loseNext: () => {
      lose = true;
    },
    withdrawElsewhere: () => {
      assert.ok(current);
      current = {
        ...current,
        practiceVersion: current.practiceVersion + 1,
        publicationState: "unpublished",
      };
    },
  };
}

/** @type {() => "published"} */
const approved = () => "published";

test("practice sync recovers a lost response with the same receipt and refuses a foreign withdrawal", async (t) => {
  const f = await fixture(t);
  await validateSourcePractices(manifest, f.request);
  f.loseNext();
  await assert.rejects(
    f.journal((c) => syncSourcePractices(manifest, c, f.request)),
    /response lost/u,
  );
  // An unfinished publication resumes only with the same approval of its lesson.
  await assert.rejects(
    f.journal((c) => replayPracticeImports(c, f.request, () => "draft")),
    /interrupted transfer was publishing this practice/u,
  );
  await f.journal(async (c) => {
    await replayPracticeImports(c, f.request, approved);
    await syncSourcePractices(manifest, c, f.request);
  });
  assert.equal(f.calls(), 1);
  f.withdrawElsewhere();
  await assert.rejects(
    f.journal(async (c) => {
      await replayPracticeImports(c, f.request, approved);
      await syncSourcePractices(manifest, c, f.request);
    }),
    /target changed/u,
  );
  assert.equal(f.calls(), 1);
});

test("absence is no-op, explicit withdrawal advances state, unsynchronized lesson is rejected", async (t) => {
  const f = await fixture(t);
  await f.journal((c) => syncSourcePractices(manifest, c, f.request));
  await f.journal((c) =>
    syncSourcePractices({ ...manifest, practiceDefinitions: [] }, c, f.request),
  );
  assert.equal(f.calls(), 1);
  await f.journal((c) =>
    syncSourcePractices(
      {
        ...manifest,
        practiceDefinitions: [
          { ...definition, publicationState: "unpublished" },
        ],
      },
      c,
      f.request,
    ),
  );
  assert.equal(f.calls(), 2);
  await assert.rejects(
    f.journal((c) =>
      syncSourcePractices(
        {
          ...manifest,
          practiceDefinitions: [
            {
              ...definition,
              sourceReference: {
                ...definition.sourceReference,
                materialSourceRevision: "d".repeat(64),
              },
            },
          ],
        },
        c,
        f.request,
      ),
    ),
    /not synchronized/u,
  );
});
