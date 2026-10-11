// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { manifestSchema } from "./package.mjs";
import {
  termsForTransfer,
  syncSourceTerms,
  replayTermImports,
} from "./term-import.mjs";
import { withJournal } from "./journal.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";

const definition = {
  id: "44300000-0000-4000-8000-000000000001",
  title: "Деплой",
  aliases: [],
  definition: "Авторский текст",
};
const manifest = manifestSchema.parse({
  schemaVersion: 2,
  requiredFeatures: ["terms-v1"],
  sourceNamespace: "synthetic",
  selection: {
    productId: null,
    chapterIds: [],
    materialIds: ["one"],
    taskIds: [],
    complete: true,
  },
  materials: [
    {
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
      access: "closed",
      showInFeed: false,
      difficulty: null,
      outcomes: [],
      markdown: "[[Деплой]]",
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
  terms: [
    {
      sourceId: "deploy",
      sourcePath: "terms/deploy.md",
      publicationState: "published",
      definition,
    },
  ],
});
const commandSchema = z
  .object({
    definition: z.object({ id: z.uuid() }).passthrough(),
    source: z.object({ id: z.string(), revision: z.string() }).passthrough(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    expectedTermVersion: z.number().nullable(),
  })
  .passthrough();

/** This is a CLI transport double, not a Prisma/storage substitute.
 * @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "443-term-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  /** @type {z.infer<typeof import("./local-boundaries.mjs").termReceiptSchema> | null} */
  let current = null;
  /** @type {Map<string, z.infer<typeof import("./local-boundaries.mjs").termReceiptSchema>>} */
  const receipts = new Map();
  let writes = 0;
  let lose = false;
  /** @type {import('./target.mjs').LocalTransport} */
  const transport = async (path, body, key) => {
    if (path.endsWith("/validate")) return { valid: true, current };
    const command = commandSchema.parse(body);
    assert.ok(key);
    const historical = receipts.get(key);
    if (historical !== undefined) return historical;
    assert.equal(command.expectedTermVersion, current?.termVersion ?? null);
    current = {
      termId: command.definition.id,
      termVersion: (current?.termVersion ?? 0) + 1,
      definitionDigest: "c".repeat(64),
      publicationState: command.publicationState,
      sourceId: command.source.id,
      sourceRevision: command.source.revision,
    };
    receipts.set(key, structuredClone(current));
    writes += 1;
    if (lose) {
      lose = false;
      throw new Error("response lost after commit");
    }
    return current;
  };
  /** @type {import('./local-boundaries.mjs').LocalRequest} */
  const request = async (path, body, key) =>
    parseLocalResponse(path, await transport(path, body, key));
  return {
    request,
    journal: (
      /** @type {(context: import('./journal.mjs').JournalContext) => Promise<unknown>} */ action,
    ) => withJournal(root, "http://127.0.0.1:12345", action),
    writes: () => writes,
    lose: () => {
      lose = true;
    },
    manualEdit: () => {
      assert.ok(current);
      current = {
        ...current,
        termVersion: current.termVersion + 1,
        sourceRevision: null,
      };
    },
  };
}

test("CLI repeats keep one version; updates send the current version and manual target edits stop writes", async (t) => {
  const f = await fixture(t);
  await f.journal((context) => syncSourceTerms(manifest, context, f.request));
  const repeat = await f.journal((context) =>
    syncSourceTerms(manifest, context, f.request),
  );
  assert.deepEqual(repeat, [
    { termId: definition.id, termVersion: 1, status: "unchanged" },
  ]);
  const updated = {
    ...manifest,
    terms: manifest.terms?.map((row) => ({
      ...row,
      definition: { ...row.definition, example: "Авторский пример" },
    })),
  };
  const changes = await f.journal((context) =>
    syncSourceTerms(updated, context, f.request),
  );
  assert.deepEqual(changes, [
    { termId: definition.id, termVersion: 2, status: "applied" },
  ]);
  f.manualEdit();
  await assert.rejects(
    f.journal((context) => syncSourceTerms(updated, context, f.request)),
    /target changed/u,
  );
  assert.equal(f.writes(), 2);
});

test("an uncertain write replays its exact saved key and does not create a second version", async (t) => {
  const f = await fixture(t);
  f.lose();
  await assert.rejects(
    f.journal((context) => syncSourceTerms(manifest, context, f.request)),
    /response lost/u,
  );
  await f.journal(async (context) => {
    await replayTermImports(manifest, context, f.request);
    await syncSourceTerms(manifest, context, f.request);
  });
  assert.equal(f.writes(), 1);
});

test("publish=all never promotes an authored draft definition", () => {
  const draft = {
    ...manifest,
    terms: manifest.terms?.map((row) => ({
      ...row,
      publicationState: /** @type {const} */ ("draft"),
    })),
  };
  assert.throws(
    () => termsForTransfer(draft, () => "published"),
    /Unpublished term/u,
  );
  assert.equal(
    termsForTransfer(manifest, () => "draft").terms?.[0]?.publicationState,
    "draft",
  );
  assert.equal(
    termsForTransfer(manifest, () => "published").terms?.[0]?.publicationState,
    "published",
  );
});
