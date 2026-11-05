// @ts-check
import { z } from "zod";
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonical, checksum } from "./package.mjs";
import { fixture, receiver } from "./snapshot-test-support.mjs";
import { runDelivery } from "./deliver.mjs";
import { pinnedNode } from "./delivery-environment.mjs";
import { authoringTarget } from "./target.mjs";
import { loadSnapshot, previewSnapshot, applySnapshot } from "./snapshot.mjs";

test("snapshot loads two guide packages and a standalone article without changing their bytes", async (t) => {
  const f = await fixture(t);
  const before = await readFile(join(f.root, "guide-one/package.json"));
  const snapshot = await loadSnapshot(f.path);
  assert.equal(snapshot.entries.length, 3);
  assert.equal(snapshot.entries[2]?.pkg.manifest.selection.productId, null);
  assert.deepEqual(
    await readFile(join(f.root, "guide-one/package.json")),
    before,
  );
  f.envelope.entries[0] = {
    id: "escape",
    path: "../package.json",
    sha256: "a".repeat(64),
    access: {},
  };
  await f.write();
  await assert.rejects(loadSnapshot(f.path), /relative path/u);
});

test("snapshot rejects a modified constituent and repeated selected identities", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, "article/package.json"), "{}");
  await assert.rejects(loadSnapshot(f.path));
  const first = f.envelope.entries[0];
  assert.ok(first);
  f.envelope.entries[2] = { ...first, id: "duplicate" };
  await f.write();
  await assert.rejects(loadSnapshot(f.path), /Duplicate selected/u);
});

test("snapshot release previews all entries, applies once, and reads back accepted rows", async (t) => {
  const f = await fixture(t);
  const server = receiver();
  const state = join(f.root, "state");
  const options = {
    origin: "production",
    request: server.request,
    contentRepository: f.root,
    exportPackage: /** @type {import('./source-commit.mjs').ExportPackage} */ (
      async (_repo, guide) => {
        assert.equal(guide, null);
        return { commit: f.envelope.commit, packagePath: f.path };
      }
    ),
  };
  const first = await previewSnapshot(f.path, state, options);
  assert.equal(first.preview.entries.length, 3);
  assert.deepEqual(server.writes, []);
  const report = await applySnapshot(first.path, state, options);
  assert.equal(report.applied, 3);
  assert.deepEqual(
    report.delivered.map((row) => [
      row.kind,
      row.sourceId,
      row.status,
      row.revision,
      row.sourceCommit,
    ]),
    [
      ["material", "guide-one", "applied", 2, f.envelope.commit],
      ["material", "guide-two", "applied", 2, f.envelope.commit],
      ["material", "article", "applied", 2, f.envelope.commit],
    ],
  );
  const second = await previewSnapshot(f.path, state, options);
  const again = await applySnapshot(second.path, state, options);
  assert.equal(again.applied, 0);
  assert.ok(again.delivered.every((row) => row.status === "unchanged"));
});

test("deliver accepts the snapshot selection and refuses a changed later target before writes", async (t) => {
  const f = await fixture(t);
  const server = receiver();
  const state = join(f.root, "state");
  const dependencies = {
    nodeVersion: pinnedNode(),
    connect: /** @type {import('./deliver.mjs').Connect} */ (
      async (target, work) =>
        work({
          target: authoringTarget(target),
          send: server.request,
          accessToken: undefined,
          connection: { synthetic: true },
        })
    ),
    exportPackage: /** @type {import('./source-commit.mjs').ExportPackage} */ (
      async () => ({ commit: f.envelope.commit, packagePath: f.path })
    ),
  };
  const argv = [
    "preview",
    "--target",
    "production",
    "--package",
    f.path,
    "--commit",
    f.envelope.commit,
    "--state",
    state,
    "--content-repository",
    f.root,
    "--material",
    "guide-one",
    "--material",
    "guide-two",
    "--material",
    "article",
  ];
  const result = await runDelivery(argv, dependencies);
  assert.equal(result.exitCode, 0, JSON.stringify(result.document));
  const receipt = z
    .object({ receipt: z.string() })
    .parse(result.document).receipt;
  assert.equal(typeof receipt, "string");
  if (typeof receipt !== "string") throw new Error("Missing receipt");
  // A separately delivered last entry invalidates the whole reviewed snapshot.
  await server.request("/authoring/import/materials/reserve", {
    source: {
      version: 2,
      id: "inside-content:article",
      path: "article.md",
      revision: "b".repeat(64),
    },
  });
  const article = server.rows.get("inside-content:article");
  assert.ok(article);
  article.contentVersion = 9;
  // An unknown reservation is not in the journal, so use a known row and a second reviewed preview.
  await applySnapshot(receipt, state, {
    request: server.request,
    exportPackage: dependencies.exportPackage,
  });
  const reviewed = await runDelivery(argv, dependencies);
  assert.equal(reviewed.exitCode, 0);
  const next = z
    .object({ receipt: z.string() })
    .parse(reviewed.document).receipt;
  assert.equal(typeof next, "string");
  article.contentVersion += 1;
  const count = server.writes.length;
  if (typeof next !== "string") throw new Error("Missing receipt");
  const refused = await runDelivery(
    ["apply", "--receipt", next, "--state", state],
    dependencies,
  );
  assert.equal(refused.exitCode, 1);
  assert.equal(server.writes.length, count);
});

test("snapshot access overrides preserve the original course bytes", async (t) => {
  const f = await fixture(t);
  const entry = f.envelope.entries[0];
  assert.ok(entry);
  entry.access["guide-one"] = "paid";
  await f.write();
  const original = await readFile(join(f.root, entry.path));
  const server = receiver();
  const state = join(f.root, "state");
  const result = await previewSnapshot(f.path, state, {
    origin: "production",
    request: server.request,
    contentRepository: f.root,
    exportPackage: async () => ({
      commit: f.envelope.commit,
      packagePath: f.path,
    }),
  });
  const child = result.preview.entries[0];
  assert.ok(child);
  const plan = z
    .object({ materials: z.array(z.object({ access: z.string() })) })
    .parse(JSON.parse(await readFile(child.previewPath, "utf8")));
  assert.equal(plan.materials[0]?.access, "closed");
  assert.deepEqual(await readFile(join(f.root, entry.path)), original);
  entry.access = {};
  await f.write();
  await assert.rejects(loadSnapshot(f.path), /exactly the selected rows/u);
});

test("a forged export or newer selected access stops snapshot preview without target requests", async (t) => {
  const f = await fixture(t);
  const changed = await fixture(t);
  const entry = changed.envelope.entries[0];
  assert.ok(entry);
  entry.access["guide-one"] = "paid";
  await changed.write();
  let requests = 0;
  const options = {
    origin: "production",
    contentRepository: f.root,
    request: async () => {
      requests += 1;
      throw new Error("Unexpected target request");
    },
  };
  await assert.rejects(
    previewSnapshot(f.path, join(f.root, "state"), {
      ...options,
      exportPackage: async () => ({
        commit: f.envelope.commit,
        packagePath: changed.path,
      }),
    }),
    /committed export/u,
  );
  await assert.rejects(
    previewSnapshot(f.path, join(f.root, "state"), {
      ...options,
      exportPackage: async (_repo, _guide, _state, ref) => ({
        commit: f.envelope.commit,
        packagePath: ref === "HEAD" ? changed.path : f.path,
      }),
    }),
    /Content HEAD/u,
  );
  assert.equal(requests, 0);
});

test("Task page asset changes in HEAD refuse the complete snapshot before receiver access", async (t) => {
  const older = await fixture(t);
  const newer = await fixture(t);
  for (const [
    f,
    image,
  ] of /** @type {[Awaited<ReturnType<typeof fixture>>, string][]} */ ([
    [older, "old-image"],
    [newer, "new-image"],
  ])) {
    const snapshot = await loadSnapshot(f.path);
    const entry = snapshot.entries[0];
    assert.ok(entry);
    const manifest = entry.pkg.manifest;
    const row = manifest.materials[0];
    assert.ok(row);
    manifest.products = [
      {
        sourceId: "course",
        title: "Course",
        summary: "",
        complete: true,
        materialIds: [row.sourceId],
        supplementaryMaterialIds: [],
        chapters: [
          {
            sourceId: "chapter",
            title: "Chapter",
            summary: "",
            materialIds: [row.sourceId],
          },
        ],
      },
    ];
    manifest.tasks = [
      {
        sourceId: "assignment",
        productId: "course",
        chapterId: "chapter",
        title: "Assignment",
        access: "free",
        definition: {},
        relatedMaterialIds: [],
        publicationState: "unpublished",
        provenance: {
          repository: "synthetic/content",
          commit: f.envelope.commit,
          path: "assignment.yaml",
        },
        page: {
          ...row,
          sourceId: "assignment",
          sourcePath: "assignment.md",
          markdown: "![Image](image.png)",
          images: { "image.png": "image" },
        },
      },
    ];
    manifest.selection.taskIds = ["assignment"];
    manifest.assets = [
      {
        sourceId: "image",
        path: "image.png",
        sha256: checksum(image),
        mimeType: "image/png",
      },
    ];
    await writeFile(join(entry.pkg.directory, "image.png"), image);
    const bytes = canonical(manifest);
    await writeFile(entry.packagePath, bytes);
    const envelopeEntry = f.envelope.entries[0];
    assert.ok(envelopeEntry);
    envelopeEntry.sha256 = checksum(bytes);
    envelopeEntry.access["assignment"] = "free";
    await f.write();
  }
  let requests = 0;
  await assert.rejects(
    previewSnapshot(older.path, join(older.root, "state"), {
      origin: "production",
      contentRepository: older.root,
      exportPackage: async (_repo, _guide, _state, ref) => ({
        commit: older.envelope.commit,
        packagePath: ref === "HEAD" ? newer.path : older.path,
      }),
      request: async () => {
        requests += 1;
        throw new Error("Unexpected target request");
      },
    }),
    /Content HEAD/u,
  );
  assert.equal(requests, 0);
});

test("apply refuses Content HEAD access drift after preview before any receiver write", async (t) => {
  const f = await fixture(t);
  const changed = await fixture(t);
  const entry = changed.envelope.entries[0];
  assert.ok(entry);
  entry.access["guide-one"] = "paid";
  await changed.write();
  let head = f.path;
  const server = receiver();
  const state = join(f.root, "state");
  const options = {
    origin: "production",
    request: server.request,
    contentRepository: f.root,
    exportPackage: /** @type {import("./source-commit.mjs").ExportPackage} */ (
      async (_repo, _guide, _state, ref) => ({
        commit: f.envelope.commit,
        packagePath: ref === "HEAD" ? head : f.path,
      })
    ),
  };
  const reviewed = await previewSnapshot(f.path, state, options);
  head = changed.path;
  await assert.rejects(
    applySnapshot(reviewed.path, state, options),
    /Content HEAD/u,
  );
  assert.deepEqual(server.writes, []);
});
