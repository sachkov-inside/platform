// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withJournal } from "./journal.mjs";
import { canonical, checksum } from "./package.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";
import { replayPracticeImports } from "./practice-import.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const operation = {
  path: "/authoring/import/practices/apply",
  body: {
    practiceId: "synthetic:brief",
    definition: { schemaVersion: 1, title: "Original" },
    sourceReference: {
      materialSourceId: "synthetic:lesson",
      materialSourceRevision: "a".repeat(64),
    },
    provenance: {
      repository: "synthetic/fixture",
      commit: "b".repeat(40),
      path: "original.json",
    },
    publicationState: "published",
    materialId,
    expectedContentVersion: 7,
    expectedPracticeVersion: null,
  },
};
const key = `authoring:${checksum(canonical(operation))}`;
const receipt = {
  practiceId: "synthetic:brief",
  practiceVersion: 19,
  definitionDigest: "c".repeat(64),
  materialId,
  boundContentVersion: 7,
  publicationState: "published",
};

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "legacy-practice-replay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  /** @param {(context: import('./journal.mjs').JournalContext) => Promise<void>} action */
  const journal = (action) =>
    withJournal(root, "http://127.0.0.1:12345", action);
  await journal(async (context) => {
    context.journal.operations[key] = {
      request: structuredClone(operation),
      status: "pending",
    };
    await context.persist();
  });
  return { journal };
}

test("historical uncertain Practice replay keeps exact original bytes/key/receipt and publication approval without creating a current Practice import", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  /** @type {import('./local-boundaries.mjs').LocalRequest} */
  const request = async (path, body, idempotencyKey) => {
    calls++;
    assert.equal(path, "/authoring/history/practice-receipts");
    assert.deepEqual(body, operation.body);
    assert.equal(idempotencyKey, key);
    return parseLocalResponse(path, receipt);
  };
  await assert.rejects(
    f.journal((context) =>
      replayPracticeImports(context, request, () => "draft"),
    ),
    /same publication approval/u,
  );
  assert.equal(calls, 0);
  await f.journal(async (context) => {
    await replayPracticeImports(context, request, () => "published");
    assert.deepEqual(context.journal.operations[key], {
      request: operation,
      status: "applied",
      result: receipt,
    });
    assert.equal(Object.keys(context.journal.operations).length, 1);
  });
  await f.journal((context) =>
    replayPracticeImports(context, request, () => "published"),
  );
  assert.equal(calls, 1);
});

test("a proven absent historical receipt resolves the old request without inventing a replacement key", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  /** @type {import('./local-boundaries.mjs').LocalRequest} */
  const request = async () => {
    calls++;
    throw Object.assign(new Error("historical_receipt_not_found"), {
      status: 404,
      body: { code: "historical_receipt_not_found" },
    });
  };
  await f.journal((context) =>
    replayPracticeImports(context, request, () => "published"),
  );
  await f.journal(async (context) => {
    await replayPracticeImports(context, request, () => "published");
    assert.deepEqual(context.journal.operations[key], {
      request: operation,
      status: "rejected",
      error: { status: 404, message: "historical_receipt_not_found" },
    });
    assert.equal(Object.keys(context.journal.operations).length, 1);
    assert.equal(
      context.journal.resources?.["practice:synthetic:brief"],
      undefined,
    );
  });
  assert.equal(calls, 1);
});
