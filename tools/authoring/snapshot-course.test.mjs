// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { fixture, receiver } from "./snapshot-test-support.mjs";
import { canonical, checksum, loadPackage } from "./package.mjs";
import { sourceUuid } from "./markdown.mjs";
import { authoringTarget } from "./target.mjs";
import { loadSnapshot, previewSnapshot, applySnapshot } from "./snapshot.mjs";

/** Existing bounded course context exercises the unchanged v1 course export path. */
test("two bounded guides and ready assignment publish together with a new standalone article", async (t) => {
  const f = await fixture(t);
  const state = join(f.root, "state");
  const server = receiver();
  const snapshot = await loadSnapshot(f.path);
  /** @type {import("./local-boundaries.mjs").StoredProduct[]} */
  const products = [];
  /** @type {import("./journal.mjs").Journal["materials"]} */
  const journalMaterials = {};
  for (const entry of snapshot.entries.slice(0, 2)) {
    const manifest = entry.pkg.manifest;
    const row = manifest.materials[0];
    assert.ok(row);
    const product = {
      sourceId: entry.id,
      title: entry.id,
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
    };
    manifest.products = [product];
    manifest.requiredFeatures = ["bounded-content-v1"];
    manifest.selection.contentOnly = {
      materialIds: [row.sourceId],
      taskIds: [],
      artifactIds: [],
    };
    products.push({
      id: sourceUuid(entry.id),
      sourceId: `inside-content:${entry.id}`,
      slug: entry.id,
      name: entry.id,
      summary: "",
      version: 1,
    });
    await server.request("/authoring/import/materials/reserve", {
      source: {
        version: 2,
        id: `inside-content:${row.sourceId}`,
        path: row.sourcePath,
        revision: "b".repeat(64),
      },
    });
    const held = server.rows.get(`inside-content:${row.sourceId}`);
    assert.ok(held);
    held.publicationState = "published";
    journalMaterials[`inside-content:${row.sourceId}`] = {
      materialId: held.materialId,
      contentVersion: 1,
      digest: "c".repeat(64),
      url: `/materials/${row.sourceId}`,
    };
    if (entry.id === "guide-one") {
      manifest.tasks = [
        {
          sourceId: "assignment",
          productId: entry.id,
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
          page: { ...row, sourceId: "assignment", sourcePath: "assignment.md" },
        },
      ];
      manifest.selection.taskIds = ["assignment"];
      manifest.selection.contentOnly.taskIds = ["assignment"];
      const envelopeEntry = f.envelope.entries.find(
        (item) => item.id === entry.id,
      );
      assert.ok(envelopeEntry);
      envelopeEntry.access["assignment"] = "paid";
    }
    const bytes = canonical(manifest);
    await writeFile(entry.packagePath, bytes);
    const envelopeEntry = f.envelope.entries.find(
      (item) => item.id === entry.id,
    );
    assert.ok(envelopeEntry);
    envelopeEntry.sha256 = checksum(bytes);
  }
  await f.write();
  await mkdir(state);
  await writeFile(
    join(state, "journal.json"),
    canonical({
      schemaVersion: 1,
      target: authoringTarget("production").id,
      materials: journalMaterials,
      products: {},
      operations: {},
      resources: {},
    }),
  );
  const task = {
    taskId: sourceUuid("assignment"),
    code: "assignment",
    revision: 1,
    currentVersion: 1,
    definitionDigest: "d".repeat(64),
    publicationState: "unpublished",
  };
  let taskAccess = "free";
  let taskCommit = f.envelope.commit;
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path, body, key) => {
    if (path === "/authoring/collections?kind=product") return products;
    if (path === "/authoring/import/tasks/validate")
      return { valid: true, current: structuredClone(task) };
    if (path === "/authoring/import/tasks/apply") {
      const command = z
        .object({ publicationState: z.string(), access: z.string() })
        .parse(body);
      task.publicationState = command.publicationState;
      taskAccess = command.access;
      task.revision += 1;
      return structuredClone(task);
    }
    if (path.includes("/tasks/state?"))
      return {
        namespace: "inside-content",
        tasks: [
          {
            ...task,
            sourceId: "inside-content:assignment",
            productId: sourceUuid("guide-one"),
            chapterId: sourceUuid("chapter"),
            position: 1,
            afterMaterialSourceId: null,
            programmeVisibility: "standalone",
            embeddedMaterialId: null,
            access: taskAccess,
            sourceCommit: taskCommit,
          },
        ],
      };
    const response = await server.request(path, body, key);
    if (path.startsWith("/authoring/materials/")) {
      const material = z
        .object({
          materialId: z.string(),
          metadata: z.record(z.string(), z.unknown()),
        })
        .passthrough()
        .parse(response);
      const product = products.find(
        (item) =>
          sourceUuid(`inside-content:${item.slug}`) === material.materialId,
      );
      material.metadata["productMemberships"] = product
        ? [{ productId: product.id, ordinal: 1 }]
        : [];
      return material;
    }
    return response;
  };
  const options = {
    origin: "production",
    contentRepository: f.root,
    request,
    exportPackage: async () => ({
      commit: f.envelope.commit,
      packagePath: f.path,
    }),
  };
  const original = await readFile(join(f.root, "guide-one/package.json"));
  const preview = await previewSnapshot(f.path, state, options);
  const first = preview.preview.entries[0];
  assert.ok(first);
  const child = z
    .object({ tasks: z.array(z.object({ publication: z.string() })) })
    .parse(JSON.parse(await readFile(first.previewPath, "utf8")));
  assert.equal(child.tasks[0]?.publication, "published");
  const report = await applySnapshot(preview.path, state, options);
  assert.equal(task.publicationState, "published");
  assert.equal(taskAccess, "closed");
  assert.deepEqual(
    report.delivered.find((row) => row.sourceId === "assignment"),
    {
      kind: "task",
      sourceId: "assignment",
      sourcePath: "assignment.yaml",
      sourceCommit: f.envelope.commit,
      status: "applied",
      revision: 2,
      origin: "production",
      recordedAt: report.delivered.find((row) => row.sourceId === "assignment")
        ?.recordedAt,
    },
  );
  assert.deepEqual(
    await readFile(join(f.root, "guide-one/package.json")),
    original,
  );
  assert.equal(
    (await loadPackage(join(f.root, "guide-one/package.json"))).manifest
      .tasks?.[0]?.publicationState,
    "unpublished",
  );
  for (const relation of ["older", "diverged"]) {
    await t.test(
      `receiver Task history refuses ${relation} snapshots before any write`,
      async () => {
        taskCommit = "b".repeat(40);
        const guarded = {
          ...options,
          isAncestor: /** @type {import('./source-commit.mjs').IsAncestor} */ (
            async (ancestor, descendant) =>
              relation === "older" &&
              ancestor === f.envelope.commit &&
              descendant === taskCommit
          ),
        };
        const count = server.writes.length;
        const revision = task.revision;
        await assert.rejects(previewSnapshot(f.path, state, guarded), {
          code: `source_commit_${relation}`,
        });
        await assert.rejects(applySnapshot(preview.path, state, guarded), {
          code: `source_commit_${relation}`,
        });
        assert.equal(server.writes.length, count);
        assert.equal(task.revision, revision);
      },
    );
  }
});
