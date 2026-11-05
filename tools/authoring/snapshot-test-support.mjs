// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, checksum } from "./package.mjs";
import { sourceUuid } from "./markdown.mjs";
import { currentEnvironment, reservationBodySchema } from "./test-support.mjs";
import { materialApplyRequest } from "./local-boundaries.mjs";
/** @param {import('node:test').TestContext} t */
export async function fixture(t) {
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

/** Synthetic receiver contract: reservations, versioned writes and authoritative state reads. */
export function receiver() {
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
