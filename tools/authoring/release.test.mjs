// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical } from "./package.mjs";
import { syncLocal } from "./local-sync.mjs";
import { materialApplyRequest } from "./local-boundaries.mjs";
import { applyRelease, previewRelease, releaseTarget } from "./release.mjs";
import { itemAt, reservationBodySchema } from "./test-support.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packagePath = join(directory, "package.json");
  /** @type {import("./package.mjs").Manifest} */
  const manifest = {
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
        showInFeed: true,
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
  };
  const write = () => writeFile(packagePath, canonical(manifest));
  await write();
  return { manifest, write, packagePath, state: join(directory, "state") };
}

function api() {
  /** @type {{ materialId: string; contentVersion: number; primaryVideoId: null; cover: null; metadata: { slug: string }; source: unknown }} */
  const material = {
    materialId,
    contentVersion: 1,
    primaryVideoId: null,
    cover: null,
    metadata: { slug: "one" },
    source: null,
  };
  /** @type {string[]} */
  const writes = [];
  return {
    material,
    writes,
    /** @type {import("./target.mjs").LocalTransport} */
    async request(path, body) {
      if (path.endsWith("/environment")) return { mode: "development" };
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/collections?kind=guide") return [];
      if (path.endsWith("/validate")) return { valid: true };
      if (path === `/authoring/materials/${materialId}`)
        return structuredClone(material);
      if (path.endsWith("/reserve")) {
        writes.push(path);
        material.source = reservationBodySchema.parse(body).source;
        return structuredClone(material);
      }
      if (path.endsWith("/apply")) {
        writes.push(path);
        const command = materialApplyRequest({ path, body })?.body;
        assert.ok(command);
        assert.equal(command.expectedContentVersion, material.contentVersion);
        Object.assign(material, {
          contentVersion: material.contentVersion + 1,
          source: command.source,
        });
        return { materialId, contentVersion: material.contentVersion };
      }
      throw new Error(`Unexpected ${path}`);
    },
  };
}

test("preview reads only and apply releases exactly the reviewed package", async (t) => {
  const setup = await fixture(t);
  const server = api();
  const first = await previewRelease(setup.packagePath, setup.state, {
    origin: "http://127.0.0.1:4396",
    request: server.request,
  });
  assert.deepEqual(first.summary, {
    new: 1,
    changed: 0,
    restore: 0,
    unchanged: 0,
    conflict: 0,
  });
  assert.deepEqual(server.writes, []);
  const report = await applyRelease(first.path, setup.state, {
    request: server.request,
  });
  assert.equal(report.applied, 1);
  itemAt(setup.manifest.materials, 0).markdown = "Changed text";
  itemAt(setup.manifest.materials, 0).showInFeed = false;
  await setup.write();
  const second = await previewRelease(setup.packagePath, setup.state, {
    origin: "http://127.0.0.1:4396",
    request: server.request,
  });
  assert.equal(itemAt(second.preview.materials, 0).change, "changed");
  assert.deepEqual(itemAt(second.preview.materials, 0).feedChange, {
    from: true,
    to: false,
  });
});

test("drift after preview, an edited preview and unreviewed archive requests stop before any write", async (t) => {
  const setup = await fixture(t);
  const server = api();
  await syncLocal(setup.packagePath, setup.state, { request: server.request });
  itemAt(setup.manifest.materials, 0).markdown = "Next";
  await setup.write();
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    origin: "http://127.0.0.1:4396",
    request: server.request,
  });
  const writes = server.writes.length;
  await assert.rejects(
    applyRelease(reviewed.path, setup.state, {
      request: server.request,
      archive: ["other"],
    }),
    /reviewed proposals/u,
  );
  const edited = JSON.parse(await readFile(reviewed.path, "utf8"));
  edited.archiveProposals = ["inside-content:other"];
  await writeFile(reviewed.path, JSON.stringify(edited));
  await assert.rejects(
    applyRelease(reviewed.path, setup.state, { request: server.request }),
    /changed after review/u,
  );
  const fresh = await previewRelease(setup.packagePath, setup.state, {
    origin: "http://127.0.0.1:4396",
    request: server.request,
  });
  server.material.contentVersion += 1;
  await assert.rejects(
    applyRelease(fresh.path, setup.state, { request: server.request }),
    /conflicts|changed after the preview/u,
  );
  assert.equal(server.writes.length, writes);
});

test("a non-local release target is refused", () => {
  assert.equal(releaseTarget("stand"), "http://127.0.0.1:4398");
  assert.throws(
    () => releaseTarget("https://sachkov-inside.ru"),
    /separate owner approval/u,
  );
  assert.throws(() => releaseTarget("production"), /separate owner approval/u);
});
