// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { parseJournal } from "./local-boundaries.mjs";
import { canonical, checksum, loadPackage } from "./package.mjs";

/** Synthetic source, never a Content original. */
function fixture() {
  return {
    schemaVersion: 3,
    requiredFeatures: ["canonical-product-source-v2"],
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
        kind: "guide",
        title: "Guide",
        summary: "Summary",
        stage: "draft",
        topicId: null,
        access: "closed",
        difficulty: null,
        outcomes: [],
        markdown: "Authored guide and series text",
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
  };
}

test("v3 loads a canonical Product package without a feed field and preserves original identity", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "authoring-v3-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "package.json");
  const original = fixture();
  const bytes = canonical(original);
  await writeFile(path, bytes);
  const pkg = await loadPackage(path);
  assert.equal(pkg.id, checksum(bytes));
  assert.equal(await readFile(path, "utf8"), bytes);
  assert.deepEqual(pkg.manifest, original);
});

test("sync sends only Source v2 and Product metadata for a v3 package", async (t) => {
  const { syncLocal, reviewOrigin } = await import("./local-sync.mjs");
  const directory = await mkdtemp(join(tmpdir(), "authoring-v3-sync-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "package.json");
  await writeFile(path, canonical(fixture()));
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  /** @type {string[]} */
  const calls = [];
  const report = await syncLocal(path, join(directory, "state"), {
    origin: reviewOrigin,
    defaultAccess: "closed",
    publish: [],
    request: async (route, body) => {
      calls.push(route);
      if (route === "/authoring/import/materials/environment")
        return {
          mode: "development",
          contract: {
            version: 2,
            packageFeatures: ["canonical-product-source-v2"],
          },
        };
      if (route === "/authoring/collections?kind=topic") return [];
      if (
        route === "/authoring/import/materials/reserve" ||
        route === "/authoring/import/materials/validate" ||
        route === "/authoring/import/materials/apply"
      ) {
        assert.ok(body && typeof body === "object" && "source" in body);
        const source = z.record(z.string(), z.unknown()).parse(body.source);
        assert.deepEqual(Object.keys(source).sort(), [
          "id",
          "path",
          "revision",
          "version",
        ]);
        assert.equal(source["version"], 2);
        if ("metadata" in body) {
          const metadata = z
            .record(z.string(), z.unknown())
            .parse(body.metadata);
          assert.deepEqual(metadata["productIds"], []);
          assert.equal(Object.hasOwn(metadata, "seriesIds"), false);
        }
        return route.endsWith("validate")
          ? { valid: true }
          : { materialId: id, contentVersion: route.endsWith("apply") ? 2 : 1 };
      }
      if (route === `/authoring/materials/${id}`)
        return {
          materialId: id,
          contentVersion: 1,
          publicationState: "draft",
          primaryVideoId: null,
          source: {
            version: 2,
            id: "synthetic:one",
            path: "one.md",
            revision: "a".repeat(64),
          },
          metadata: { slug: "one", productMemberships: [] },
        };
      throw new Error(`Unexpected ${route}`);
    },
  });
  assert.equal(report.applied, 1);
  assert.ok(calls.includes("/authoring/import/materials/apply"));
});

test("an uncertain old Material request recovers through receipt lookup with its exact original key and bytes", async (t) => {
  const { syncLocal, reviewOrigin } = await import("./local-sync.mjs");
  const { withJournal } = await import("./journal.mjs");
  const directory = await mkdtemp(join(tmpdir(), "authoring-history-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "package.json");
  const state = join(directory, "state");
  await writeFile(path, canonical(fixture()));
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const original = {
    path: "/authoring/import/materials/apply",
    body: {
      source: {
        id: "synthetic:one",
        path: "one.md",
        revision: "a".repeat(64),
        showInFeed: false,
      },
      materialId: id,
      expectedContentVersion: 1,
      publicationState: "draft",
      primaryVideoId: null,
      metadata: {
        title: "Guide",
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
  };
  const key = `authoring:${checksum(canonical(original))}`;
  await withJournal(state, reviewOrigin, async ({ journal, persist }) => {
    journal.operations[key] = { status: "pending", request: original };
    await persist();
  });
  const receipt = { materialId: id, contentVersion: 2 };
  /** @type {string[]} */
  const lookups = [];
  let loseReply = true;
  const resume = () =>
    syncLocal(path, state, {
      reconcileOnly: true,
      request: async (route, body, sentKey) => {
        if (route === "/authoring/import/materials/environment")
          return {
            mode: "development",
            contract: {
              version: 2,
              packageFeatures: ["canonical-product-source-v2"],
            },
          };
        assert.equal(route, "/authoring/history/material-receipts");
        assert.equal(sentKey, key);
        assert.deepEqual(body, original.body);
        lookups.push(route);
        if (loseReply) {
          loseReply = false;
          throw new TypeError("Lost historical lookup response");
        }
        return receipt;
      },
    });
  await assert.rejects(resume(), /Lost historical lookup response/u);
  const pending = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  assert.deepEqual(pending.operations[key], {
    status: "pending",
    request: original,
  });
  await resume();
  await resume();
  assert.equal(lookups.length, 2);
  const saved = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  assert.deepEqual(saved.operations[key], {
    status: "applied",
    request: original,
    result: receipt,
  });
  assert.equal(saved.materials["synthetic:one"]?.contentVersion, 2);
});

for (const [
  description,
  edit,
  message,
] of /** @type {[string, (value: ReturnType<typeof fixture>) => void, RegExp][]} */ ([
  [
    "a feed field",
    (value) => {
      const row = value.materials[0];
      assert.ok(row);
      Object.assign(row, { showInFeed: false });
    },
    /forbids showInFeed/u,
  ],
  [
    "missing canonical capability",
    (value) => {
      value.requiredFeatures = [];
    },
    /requires canonical-product-source-v2/u,
  ],
  [
    "retired Practice imports",
    (value) => {
      Object.assign(value, { practiceDefinitions: [] });
    },
    /accepts Tasks/u,
  ],
  [
    "legacy collection aliases",
    (value) => {
      Object.assign(value, { guides: value.products });
    },
    /unrecognized_keys|Unrecognized key/u,
  ],
])) {
  test(`v3 rejects ${description} before any transport`, async (t) => {
    const { syncLocal } = await import("./local-sync.mjs");
    const directory = await mkdtemp(join(tmpdir(), "authoring-v3-negative-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "package.json");
    const original = fixture();
    edit(original);
    await writeFile(path, canonical(original));
    await assert.rejects(
      syncLocal(path, join(directory, "state"), {
        request: async () =>
          assert.fail("invalid package must fail before transport"),
      }),
      message,
    );
  });
}

for (const missing of [true, false]) {
  test(`old Material recovery ${missing ? "keeps an unbound absent receipt pending" : "keeps an unavailable lookup pending"} without dispatching a write`, async (t) => {
    const { syncLocal, reviewOrigin } = await import("./local-sync.mjs");
    const { withJournal } = await import("./journal.mjs");
    const directory = await mkdtemp(
      join(tmpdir(), "authoring-history-absent-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "package.json");
    const state = join(directory, "state");
    await writeFile(path, canonical(fixture()));
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const original = {
      path: "/authoring/import/materials/apply",
      body: {
        source: {
          id: "synthetic:one",
          path: "one.md",
          revision: "a".repeat(64),
          showInFeed: false,
        },
        materialId: id,
        expectedContentVersion: 1,
        publicationState: "draft",
        primaryVideoId: null,
        metadata: {
          title: "Guide",
          summary: "Summary",
          access: "closed",
          difficulty: null,
          outcomes: [],
          topicId: null,
          formatId: "guide",
          tagIds: [],
          seriesIds: [],
        },
        body: { schemaVersion: 1, doc: { type: "doc", content: [] } },
      },
    };
    const key = `authoring:${checksum(canonical(original))}`;
    await withJournal(state, reviewOrigin, async ({ journal, persist }) => {
      journal.operations[key] = { status: "pending", request: original };
      await persist();
    });
    const work = syncLocal(path, state, {
      reconcileOnly: true,
      request: async (route, body, sentKey) => {
        if (route === "/authoring/import/materials/environment")
          return {
            mode: "development",
            contract: {
              version: 2,
              packageFeatures: ["canonical-product-source-v2"],
            },
          };
        assert.equal(route, "/authoring/history/material-receipts");
        assert.equal(sentKey, key);
        assert.deepEqual(body, original.body);
        throw Object.assign(new Error("Not found"), {
          status: 404,
          body: {
            code: missing ? "historical_receipt_not_found" : "route_not_found",
          },
        });
      },
    });
    await assert.rejects(work, /lookup unavailable; recovery required/u);
    const saved = parseJournal(
      JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
    );
    assert.equal(saved.operations[key]?.status, "pending");
    assert.deepEqual(saved.operations[key]?.request, original);
    assert.deepEqual(saved.materials, {});
  });
}

test("direct v3 sync refuses an old receiver before any write", async (t) => {
  const { syncLocal } = await import("./local-sync.mjs");
  const directory = await mkdtemp(join(tmpdir(), "authoring-old-receiver-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "package.json");
  await writeFile(path, canonical(fixture()));
  await assert.rejects(
    syncLocal(path, join(directory, "state"), {
      request: async (route, body) => {
        assert.equal(route, "/authoring/import/materials/environment");
        assert.equal(body, undefined);
        return {
          mode: "development",
          contract: {
            version: 1,
            packageFeatures: ["canonical-product-source-v2"],
          },
        };
      },
    }),
    /receiver speaks import contract 1; this client speaks 2/u,
  );
});

test("an uncertain Series composition stays pending and stops a current transfer before effects", async (t) => {
  const { syncLocal, reviewOrigin } = await import("./local-sync.mjs");
  const { withJournal } = await import("./journal.mjs");
  const directory = await mkdtemp(join(tmpdir(), "authoring-old-composition-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "package.json");
  const state = join(directory, "state");
  await writeFile(path, canonical(fixture()));
  const original = {
    path: "/authoring/import/products/composition",
    body: {
      seriesId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedOrderVersion: "a".repeat(64),
      orderedMaterialIds: [],
    },
  };
  const key = `authoring:${checksum(canonical(original))}`;
  await withJournal(state, reviewOrigin, async ({ journal, persist }) => {
    journal.operations[key] = { status: "pending", request: original };
    await persist();
  });
  await assert.rejects(
    syncLocal(path, state, {
      request: async (route, body) => {
        assert.equal(route, "/authoring/import/materials/environment");
        assert.equal(body, undefined);
        return {
          mode: "development",
          contract: {
            version: 2,
            packageFeatures: ["canonical-product-source-v2"],
          },
        };
      },
    }),
    /explicit recovery required before effects/u,
  );
  const saved = parseJournal(
    JSON.parse(await readFile(join(state, "journal.json"), "utf8")),
  );
  assert.deepEqual(saved.operations[key], {
    status: "pending",
    request: original,
  });
  assert.deepEqual(saved.materials, {});
});
