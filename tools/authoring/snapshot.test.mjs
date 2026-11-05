// @ts-check
import { z } from "zod";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, checksum } from "./package.mjs";
import { currentEnvironment, reservationBodySchema } from "./test-support.mjs";
import { materialApplyRequest } from "./local-boundaries.mjs";
import { sourceUuid } from "./markdown.mjs";
import { runDelivery } from "./deliver.mjs";
import { pinnedNode } from "./delivery-environment.mjs";
import { authoringTarget } from "./target.mjs";
import { loadSnapshot, previewSnapshot, applySnapshot } from "./snapshot.mjs";

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "authoring-snapshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entries = [];
  for (const id of ["guide-one", "guide-two", "article"]) {
    const row = {
      sourceId: id,
      sourcePath: `${id}.md`,
      sourceIds: [],
      relatedMaterialIds: [],
      readingTimeMinutes: null,
      kind: "note",
      title: id,
      summary: "Summary",
      stage: "ready",
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
    };
    const manifest = {
      schemaVersion: 2,
      requiredFeatures: [],
      sourceNamespace: "inside-content",
      selection: {
        guideId: id === "article" ? null : id,
        chapterIds: [],
        materialIds: [id],
        taskIds: [],
        complete: true,
      },
      guides: [],
      materials: [row],
      tasks: [],
      assets: [],
      diagnostics: [],
    };
    const bytes = canonical(manifest);
    await mkdir(join(root, id));
    await writeFile(join(root, id, "package.json"), bytes);
    entries.push({
      id,
      path: `${id}/package.json`,
      sha256: checksum(bytes),
      access: { [id]: "free" },
    });
  }
  const envelope = {
    contract: "platform-package-v2",
    commit: "a".repeat(40),
    entries,
  };
  const path = join(root, "snapshot.json");
  const write = () => writeFile(path, canonical(envelope));
  await write();
  return { root, path, envelope, write };
}

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

/** Synthetic receiver contract: reservations, versioned writes and authoritative state reads. */
function receiver() {
  /** @type {Map<string, {materialId: string, contentVersion: number, primaryVideoId: null, cover: null, publicationState: string, metadata: {slug: string, access: string}, source: {id: string, path: string, revision: string, commit?: string, version?: number}}>} */
  const rows = new Map();
  /** @type {string[]} */
  const writes = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path, body) => {
    if (path.endsWith("/environment")) return currentEnvironment("production");
    if (path.startsWith("/authoring/collections?")) return [];
    if (path.endsWith("/validate")) return { valid: true };
    if (path.includes("/materials/state?"))
      return {
        namespace: "inside-content",
        materials: [...rows.values()].map((row) => ({
          sourceId: row.source.id,
          materialId: row.materialId,
          slug: row.metadata.slug,
          contentVersion: row.contentVersion,
          access: row.metadata.access,
          publicationState: row.publicationState,
          source: {
            ...row.source,
            version: 2,
            commit: row.source.commit ?? null,
          },
          memberships: [],
        })),
      };
    if (path.includes("/tasks/state?"))
      return { namespace: "inside-content", tasks: [] };
    if (path.endsWith("/reserve")) {
      const { source } = reservationBodySchema.parse(body);
      const key = source.id;
      let row = rows.get(key);
      if (!row) {
        row = {
          materialId: sourceUuid(key),
          contentVersion: 1,
          primaryVideoId: null,
          cover: null,
          publicationState: "draft",
          metadata: { slug: key.split(":")[1] ?? key, access: "free" },
          source: {
            id: key,
            version: 2,
            path: "reserved.md",
            revision: "b".repeat(64),
          },
        };
        rows.set(key, row);
      }
      writes.push(path);
      return structuredClone(row);
    }
    if (path.startsWith("/authoring/materials/")) {
      const row = [...rows.values()].find((value) =>
        path.endsWith(value.materialId),
      );
      assert.ok(row);
      return structuredClone(row);
    }
    if (path.endsWith("/apply")) {
      const command = materialApplyRequest({ path, body })?.body;
      assert.ok(command);
      const row = rows.get(command.source.id);
      assert.ok(row);
      assert.equal(command.expectedContentVersion, row.contentVersion);
      row.contentVersion += 1;
      row.source = {
        ...command.source,
        commit: String(command.source["commit"]),
      };
      row.metadata.access = command.metadata.access;
      row.publicationState = command.publicationState;
      writes.push(path);
      return { materialId: row.materialId, contentVersion: row.contentVersion };
    }
    throw new Error(`Unexpected ${path}`);
  };
  return { request, writes, rows };
}

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
  const report = await applySnapshot(first.path, state, {
    request: server.request,
  });
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
  const again = await applySnapshot(second.path, state, {
    request: server.request,
  });
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
  await applySnapshot(receipt, state, { request: server.request });
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
