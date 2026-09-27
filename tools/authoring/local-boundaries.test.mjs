// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, checksum } from "./package.mjs";
import {
  localResponseKind,
  parseLocalResponse,
  parseJournal,
} from "./local-boundaries.mjs";
import { syncLocal, reviewOrigin } from "./local-sync.mjs";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "local-boundaries-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packagePath = join(directory, "package.json");
  const state = join(directory, "state");
  await mkdir(state);
  await writeFile(
    packagePath,
    canonical({
      schemaVersion: 1,
      sourceNamespace: "inside-content",
      selection: {
        guideId: null,
        chapterIds: [],
        materialIds: ["one"],
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
          access: "free",
          showInFeed: false,
          difficulty: null,
          outcomes: [],
          markdown: "Text",
          links: {},
          images: {},
          coverAssetId: null,
          coverAlt: null,
          video: null,
          videoChapters: [],
          artifacts: [],
        },
      ],
      guides: [],
      assets: [],
      diagnostics: [],
    }),
  );
  return { packagePath, state };
}

/**
 * A path and the schema its type names; the compiler checks the name against LocalResponseKindOf.
 *
 * @template {string} P
 * @param {P} path
 * @param {import("./local-boundaries.mjs").LocalResponseKindOf<P>} kind
 * @returns {[string, string]}
 */
const typedKind = (path, kind) => [path, kind];

// The type of a response and the schema that checks it come from one path: this table pins the
// written type and the runtime selection to the same answer for every boundary.
test("each local path selects the schema its response type names", () => {
  for (const [path, kind] of [
    typedKind("/authoring/import/materials/environment", "environment"),
    typedKind("/authoring/collections?kind=topic", "topics"),
    typedKind("/authoring/collections?kind=guide", "guides"),
    typedKind("/authoring/collections", "topic"),
    typedKind("/authoring/import/materials/validate", "valid"),
    typedKind("/authoring/import/guides/validate", "valid"),
    typedKind("/authoring/import/materials/reserve", "materialReceipt"),
    typedKind("/authoring/import/materials/apply", "materialReceipt"),
    typedKind("/authoring/import/guides/reserve", "guide"),
    typedKind("/authoring/import/guides/update", "guide"),
    typedKind("/authoring/import/guides/composition", "order"),
    typedKind("/authoring/home-pin", "homePin"),
    typedKind(`/authoring/materials/${id}/assets`, "assetReceipt"),
    typedKind(`/authoring/materials/${id}/videos/attach`, "video"),
    typedKind(`/authoring/materials/${id}/videos/uploads`, "videoUpload"),
    typedKind(`/authoring/videos/${id}/reconcile`, "video"),
    typedKind(`/authoring/materials/${id}`, "material"),
    typedKind(`/authoring/import/content-covers/material/${id}`, "coverChange"),
    typedKind(`/authoring/import/content-covers/series/${id}`, "coverChange"),
    typedKind(`/authoring/import/guides/${id}/artifacts`, "artifactOutcome"),
    typedKind(`/authoring/guides/${id}/artifacts`, "guideArtifacts"),
    typedKind(`/authoring/guide-artifacts/${id}/materials`, "artifact"),
    typedKind(`/authoring/guides/${id}/order`, "guideOrder"),
  ])
    assert.equal(localResponseKind(path), kind, path);
  assert.throws(
    () => localResponseKind("/authoring/unknown"),
    /Unsupported local response boundary/u,
  );
});

// Every response schema rejects corrupt consumed fields without relying on a transport implementation.
/** @type {[string, unknown][]} */
const malformedResponses = [
  ["/authoring/import/materials/environment", { mode: false }],
  ["/authoring/collections?kind=topic", [{ id: "not-a-uuid", slug: "topic" }]],
  ["/authoring/collections", { id, slug: null }],
  ["/authoring/import/materials/validate", { valid: false }],
  [
    "/authoring/import/materials/reserve",
    { materialId: id, contentVersion: "1" },
  ],
  ["/authoring/import/materials/apply", { materialId: id, contentVersion: -1 }],
  [
    `/authoring/materials/${id}`,
    {
      materialId: id,
      contentVersion: 1,
      primaryVideoId: null,
      metadata: { slug: "one" },
      source: { revision: 123 },
    },
  ],
  [
    "/authoring/import/guides/reserve",
    { id, slug: "guide", name: "Guide", summary: "", version: null },
  ],
  [
    "/authoring/import/guides/update",
    { id, slug: "guide", name: "Guide", summary: "", version: 0 },
  ],
  [`/authoring/guides/${id}/order`, { orderVersion: "corrupt" }],
  ["/authoring/import/guides/composition", { orderVersion: null }],
];
for (const [path, response] of malformedResponses)
  test(`rejects malformed response at ${path}`, () =>
    assert.throws(() => parseLocalResponse(path, response)));

test("malformed injected reservation stops local sync before read or Save", async (t) => {
  const { packagePath, state } = await fixture(t);
  /** @type {string[]} */
  const paths = [];
  await assert.rejects(
    syncLocal(packagePath, state, {
      request: async (path) => {
        paths.push(path);
        if (path.endsWith("/environment")) return { mode: "development" };
        if (path === "/authoring/collections?kind=topic") return [];
        if (path.endsWith("/validate")) return { valid: true };
        if (path.endsWith("/reserve"))
          return { materialId: "../../other-operation", contentVersion: 1 };
        throw new Error(`Unexpected mutation: ${path}`);
      },
    }),
    /Invalid UUID/,
  );
  assert.equal(paths.at(-1), "/authoring/import/materials/reserve");
  assert.equal(
    paths.some((path) => path.endsWith("/apply")),
    false,
  );
});

test("corrupt recovery entries fail before replay and leave the original journal untouched", async (t) => {
  const { packagePath, state } = await fixture(t);
  const request = {
    path: "/authoring/import/materials/apply",
    body: { source: null },
  };
  const key = `authoring:${checksum(canonical(request))}`;
  for (const entry of [
    { status: "pending", request },
    {
      status: "applied",
      request,
      result: { materialId: id, contentVersion: "2" },
    },
    {
      status: "rejected",
      request,
      error: { status: 503, message: "Not a definitive rejection" },
    },
    { assetId: "invalid" },
  ]) {
    const journal = canonical({
      schemaVersion: 1,
      target: reviewOrigin,
      materials: {},
      guides: {},
      operations: { [key]: entry },
    });
    const path = join(state, "journal.json");
    await writeFile(path, journal);
    /** @type {string[]} */
    const calls = [];
    await assert.rejects(
      syncLocal(packagePath, state, {
        request: async (apiPath) => {
          calls.push(apiPath);
          assert.equal(apiPath, "/authoring/import/materials/environment");
          return { mode: "development" };
        },
      }),
    );
    assert.deepEqual(calls, ["/authoring/import/materials/environment"]);
    assert.equal(await readFile(path, "utf8"), journal);
  }
});

test("legacy cache entries remain readable and exact generic pending requests are preserved", () => {
  const request = {
    materialId: id,
    expectedContentVersion: 1,
    body: "Original",
  };
  const key = `authoring:${checksum(canonical(request))}`;
  const journal = {
    schemaVersion: 1,
    target: reviewOrigin,
    materials: {
      one: {
        materialId: id,
        contentVersion: 2,
        digest: "a".repeat(64),
        url: "/materials/one",
      },
    },
    guides: {},
    operations: {
      [key]: { status: "pending", request },
      [`image:${id}:${"b".repeat(64)}`]: {
        assetId: id,
        presentation: { width: 640 },
      },
    },
  };
  assert.deepEqual(parseJournal(journal), journal);
  assert.throws(
    () =>
      parseJournal({
        ...journal,
        operations: { "authoring:wrong-key": { status: "pending", request } },
      }),
    /fingerprint mismatch/,
  );
});
