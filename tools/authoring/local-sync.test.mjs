// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { canonical } from "./package.mjs";
import { materialApplyRequest } from "./local-boundaries.mjs";
import { syncLocal } from "./local-sync.mjs";
import { previewRelease } from "./release.mjs";
import {
  entryAt,
  itemAt,
  operationAt,
  readJournalFile,
  reservationBodySchema,
  valueAt,
} from "./test-support.mjs";

/**
 * @typedef {import("./package.mjs").Manifest} Manifest
 * @typedef {import("./target.mjs").LocalTransport} LocalTransport
 * @typedef {{ path: string; body: unknown; key: string | undefined }} Call
 * @typedef {object} StoredMaterial
 * @property {string} materialId
 * @property {number} contentVersion
 * @property {string | null} primaryVideoId
 * @property {{ slug: string; title?: string | null; access?: string }} metadata
 * @property {Record<string, unknown>} source
 * @property {unknown} [body]
 */

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourceId = "inside-content:one";

test("real syncLocal plans term writes before Material bodies; a definition update leaves body versions unchanged", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const termId = "44300000-0000-4000-8000-000000000001";
  setup.manifest.schemaVersion = 2;
  setup.manifest.requiredFeatures = ["terms-v1"];
  setup.manifest.selection.taskIds = [];
  setup.manifest.terms = [
    {
      sourceId: "deploy",
      sourcePath: "terms/deploy.md",
      publicationState: "published",
      definition: {
        id: termId,
        title: "Деплой",
        aliases: [],
        definition: "Авторское определение для synthetic fixture",
      },
    },
  ];
  itemAt(setup.manifest.materials, 0).markdown = "[[Деплой|выкатить версию]]";
  await setup.write();
  /** @type {z.infer<typeof import("./local-boundaries.mjs").termReceiptSchema> | null} */
  let term = null;
  /** @type {string[]} */
  const paths = [];
  let termWrites = 0;
  const commandSchema = z
    .object({
      source: z.object({ id: z.string(), revision: z.string() }),
      expectedTermVersion: z.number().nullable(),
      publicationState: z.enum(["draft", "published", "unpublished"]),
    })
    .passthrough();
  /** @type {LocalTransport} */
  const request = async (path, body, key) => {
    paths.push(path);
    if (path === "/authoring/import/terms/validate")
      return { valid: true, current: term };
    if (path === "/authoring/import/terms/apply") {
      const command = commandSchema.parse(body);
      assert.equal(command.expectedTermVersion, term?.termVersion ?? null);
      assert.ok(key);
      term = {
        termId,
        termVersion: (term?.termVersion ?? 0) + 1,
        definitionDigest: "a".repeat(64),
        publicationState: command.publicationState,
        sourceId: command.source.id,
        sourceRevision: command.source.revision,
      };
      termWrites += 1;
      return term;
    }
    return api.request(path, body, key);
  };
  const first = await setup.sync({ request });
  assert.equal(first.terms?.[0]?.status, "applied");
  assert.ok(
    paths.indexOf("/authoring/import/terms/apply") <
      paths.indexOf("/authoring/import/materials/apply"),
  );
  const saved = valueAt(api.materials, sourceId);
  assert.match(JSON.stringify(saved.body), new RegExp(termId, "u"));
  assert.doesNotMatch(JSON.stringify(saved.body), /Авторское определение/u);
  const version = saved.contentVersion;
  const repeat = await setup.sync({ request });
  assert.equal(repeat.terms?.[0]?.status, "unchanged");
  const authored = itemAt(setup.manifest.terms, 0);
  authored.definition.definition =
    "Обновлённое авторское определение для synthetic fixture";
  await setup.write();
  const updated = await setup.sync({ request });
  assert.equal(updated.terms?.[0]?.termVersion, 2);
  assert.equal(valueAt(api.materials, sourceId).contentVersion, version);
  assert.equal(termWrites, 2);
});

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-local-sync-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packagePath = join(directory, "package.json");
  const stateDirectory = join(directory, "state");
  /** @type {Manifest} */
  const manifest = {
    schemaVersion: 1,
    sourceNamespace: "inside-content",
    selection: {
      productId: null,
      chapterIds: [],
      materialIds: ["one"],
      complete: true,
    },
    materials: [
      {
        sourceId: "one",
        sourcePath: "materials/one.md",
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
        markdown: "Original text",
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
  const write = () => writeFile(packagePath, canonical(manifest));
  await write();
  return {
    directory,
    manifest,
    write,
    stateDirectory,
    sync: (/** @type {{ request: LocalTransport }} */ api) =>
      syncLocal(packagePath, stateDirectory, {
        request: api.request,
        publish: "all",
      }),
  };
}

// Stateful application-API double: receipts are durable before a simulated response loss.
// No mock reaches PostgreSQL, a provider, or the loopback review gateway.
function applicationApi({ loseFirstResponse = false } = {}) {
  /** @type {Map<string, StoredMaterial>} */
  const materials = new Map();
  /** @type {Map<string, { body: unknown; result: unknown }>} */
  const receipts = new Map();
  /** @type {Call[]} */
  const calls = [];
  let commits = 0;
  let loseResponse = loseFirstResponse;
  const api = {
    materials,
    calls,
    get commits() {
      return commits;
    },
    /** @type {LocalTransport} */
    async request(path, body, key) {
      calls.push({
        path,
        body: body instanceof FormData ? body : structuredClone(body),
        key,
      });
      if (path === "/authoring/import/materials/environment")
        return { mode: "development" };
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/import/materials/validate")
        return { valid: true };
      if (path === "/authoring/import/materials/reserve") {
        const { source } = reservationBodySchema.parse(body);
        if (!materials.has(source.id))
          materials.set(source.id, {
            materialId,
            contentVersion: 1,
            primaryVideoId: null,
            metadata: { slug: "stable-original-url" },
            source,
          });
        return structuredClone(materials.get(source.id));
      }
      if (path === `/authoring/materials/${materialId}`)
        return structuredClone(materials.get(sourceId));
      if (path === `/authoring/materials/${materialId}/assets`) {
        assert.ok(body instanceof FormData);
        const uploaded = calls.filter((call) =>
          call.path.endsWith("/assets"),
        ).length;
        return {
          assetId: `92000000-0000-4000-8000-${String(uploaded).padStart(12, "0")}`,
        };
      }
      if (path === "/authoring/import/materials/apply") {
        assert.ok(key, "Every mutation must supply an idempotency key");
        const previous = receipts.get(key);
        if (previous !== undefined) {
          assert.deepEqual(
            body,
            previous.body,
            "A retry must preserve the exact command",
          );
          return structuredClone(previous.result);
        }
        const command = materialApplyRequest({ path, body })?.body;
        assert.ok(command);
        const current = valueAt(materials, command.source.id);
        assert.equal(command.materialId, current.materialId);
        if (command.expectedContentVersion !== current.contentVersion)
          throw new Error("stale_content_version");
        Object.assign(current, structuredClone(command), {
          contentVersion: current.contentVersion + 1,
          metadata: { ...command.metadata, slug: current.metadata.slug },
        });
        commits++;
        const result = {
          materialId,
          contentVersion: current.contentVersion,
          publicationState: "published",
          publishedAt: "2026-09-15T10:00:00.000Z",
        };
        receipts.set(key, structuredClone({ body, result }));
        if (loseResponse) {
          loseResponse = false;
          throw new Error("Connection lost after commit");
        }
        return result;
      }
      throw new Error(`Unexpected API request: ${path}`);
    },
  };
  return api;
}

/** @param {{ calls: Call[] }} api */
const applyCalls = (api) =>
  api.calls.filter((call) => call.path === "/authoring/import/materials/apply");

test("local restart replays a lost response with the original key and creates no extra version", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi({ loseFirstResponse: true });
  await assert.rejects(setup.sync(api), /Connection lost after commit/);
  assert.equal(api.commits, 1);
  const pending = await readJournalFile(setup.stateDirectory);
  const first = itemAt(applyCalls(api), 0);
  assert.ok(first.key);
  assert.equal(operationAt(pending, first.key).status, "pending");
  assert.deepEqual(operationAt(pending, first.key).request.body, first.body);

  const report = await setup.sync(api);
  const calls = applyCalls(api);
  assert.equal(calls.length, 2);
  assert.deepEqual(itemAt(calls, 1), itemAt(calls, 0));
  assert.equal(api.commits, 1);
  assert.equal(api.materials.size, 1);
  assert.equal(valueAt(api.materials, sourceId).contentVersion, 2);
  assert.equal(report.unchanged, 1);
  const recovered = await readJournalFile(setup.stateDirectory);
  assert.equal(operationAt(recovered, first.key).status, "applied");
  assert.equal(entryAt(recovered.materials, sourceId).contentVersion, 2);
});

test("editing and moving an original retains its material ID and URL and applies the new body once", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const first = await setup.sync(api);
  itemAt(setup.manifest.materials, 0).markdown = "Updated original text";
  itemAt(setup.manifest.materials, 0).sourcePath = "renamed/lesson.md";
  itemAt(setup.manifest.materials, 0).title = "Renamed lesson";
  await setup.write();
  const edited = await setup.sync(api);
  assert.equal(edited.applied, 1);
  assert.equal(itemAt(edited.materials, 0).url, itemAt(first.materials, 0).url);
  assert.equal(api.materials.size, 1);
  const current = valueAt(api.materials, sourceId);
  assert.equal(current.materialId, materialId);
  assert.equal(current.contentVersion, 3);
  assert.equal(current.metadata.title, "Renamed lesson");
  assert.equal(current.metadata.access, "closed");
  assert.equal(current.source["path"], "renamed/lesson.md");
  assert.match(JSON.stringify(current.body), /Updated original text/);
  assert.doesNotMatch(JSON.stringify(current.body), /Original text/);
  assert.equal((await setup.sync(api)).unchanged, 1);
  assert.equal(api.commits, 2);
});

test("an unchanged package uses its local cache without another validation, reservation or Save", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await setup.sync(api);
  const before = api.calls.length;
  const report = await setup.sync(api);
  assert.equal(report.applied, 0);
  assert.equal(report.unchanged, 1);
  assert.deepEqual(
    api.calls.slice(before).map(({ path }) => path),
    [
      "/authoring/import/materials/environment",
      "/authoring/collections?kind=topic",
    ],
  );
  assert.equal(api.commits, 1);
  assert.equal(valueAt(api.materials, sourceId).contentVersion, 2);
});

test("an edited original stops on a foreign target version and preserves the foreign body", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await setup.sync(api);
  const current = valueAt(api.materials, sourceId);
  current.contentVersion++;
  current.source = { ...current.source, revision: "f".repeat(64) };
  current.body = { foreign: "Keep this change" };
  itemAt(setup.manifest.materials, 0).markdown = "Conflicting author change";
  await setup.write();
  await assert.rejects(
    setup.sync(api),
    /target changed; reconcile before overwriting/,
  );
  assert.equal(api.commits, 1);
  assert.equal(applyCalls(api).length, 1);
  assert.equal(current.contentVersion, 3);
  assert.deepEqual(current.body, { foreign: "Keep this change" });
  const journal = await readJournalFile(setup.stateDirectory);
  assert.equal(entryAt(journal.materials, sourceId).contentVersion, 2);
});

test("a definitive 422 rejection does not replay ahead of a corrected package", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  /** @type {Call[]} */
  const transmitted = [];
  let rejectNextApply = true;
  const transport = {
    /** @type {LocalTransport} */
    async request(path, body, key) {
      if (path === "/authoring/import/materials/apply") {
        transmitted.push(structuredClone({ path, body, key }));
        if (rejectNextApply) {
          rejectNextApply = false;
          throw Object.assign(
            new Error("Invalid reference rejected before commit"),
            { status: 422 },
          );
        }
      }
      return api.request(path, body, key);
    },
  };
  await assert.rejects(setup.sync(transport), { status: 422 });
  assert.equal(api.commits, 0);
  const rejected = await readJournalFile(setup.stateDirectory);
  const first = itemAt(transmitted, 0);
  assert.ok(first.key);
  assert.equal(operationAt(rejected, first.key).status, "rejected");
  assert.equal(operationAt(rejected, first.key).error?.status, 422);
  assert.equal(valueAt(api.materials, sourceId).contentVersion, 1);

  itemAt(setup.manifest.materials, 0).markdown = "Corrected original text";
  await setup.write();
  const corrected = await setup.sync(transport);
  assert.equal(corrected.applied, 1);
  assert.equal(
    transmitted.length,
    2,
    "The rejected command must not be replayed",
  );
  const second = itemAt(transmitted, 1);
  assert.ok(second.key);
  assert.notEqual(second.key, first.key);
  assert.match(
    JSON.stringify(materialApplyRequest(second)?.body.body),
    /Corrected original text/,
  );
  assert.equal(api.commits, 1);
  assert.equal(api.materials.size, 1);
  assert.equal(valueAt(api.materials, sourceId).contentVersion, 2);
  const recovered = await readJournalFile(setup.stateDirectory);
  assert.equal(operationAt(recovered, first.key).status, "rejected");
  assert.equal(operationAt(recovered, second.key).status, "applied");
  assert.equal((await setup.sync(transport)).unchanged, 1);
  assert.equal(transmitted.length, 2);
});

test("import preserves Unicode, same-page and missing fragments in published links", async (t) => {
  const f = await fixture(t);
  const row = itemAt(f.manifest.materials, 0);
  row.markdown =
    "[Раздел](one.md#как-спроектировать-один-этап)\n\n[Повтор](#раздел-1)\n\n[Нет](one.md#нет-раздела)";
  row.links = {
    "one.md#как-спроектировать-один-этап": "one",
    "one.md#нет-раздела": "one",
  };
  await f.write();
  const api = applicationApi();
  await f.sync(api);
  const command = materialApplyRequest(itemAt(applyCalls(api), 0));
  assert.ok(command);
  const doc = JSON.stringify(command.body);
  assert.ok(doc.includes("/materials/stable-original-url#%D0%BA%D0%B0%D0%BA-"));
  assert.ok(doc.includes("#%D1%80%D0%B0%D0%B7%D0%B4%D0%B5%D0%BB-1"));
  assert.ok(doc.includes("/materials/stable-original-url#%D0%BD%D0%B5%D1%82-"));
});

test("v2 imports all four diagram assets once and preserves their relation on repeat", async (t) => {
  const setup = await fixture(t);
  setup.manifest.schemaVersion = 2;
  setup.manifest.requiredFeatures = ["image-variants-v1"];
  setup.manifest.selection.taskIds = [];
  const row = itemAt(setup.manifest.materials, 0);
  row.markdown = '![Схема](scene.png "Подпись")';
  row.images = { "scene.png": "wide-light" };
  row.imageVariants = {
    "scene.png": {
      wideLight: "wide-light",
      wideDark: "wide-dark",
      tallLight: "tall-light",
      tallDark: "tall-dark",
    },
  };
  const { checksum } = await import("./package.mjs");
  const { default: sharp } = await import("sharp");
  for (const [index, sourceId] of [
    "wide-light",
    "wide-dark",
    "tall-light",
    "tall-dark",
  ].entries()) {
    const bytes = await sharp({
      create: {
        width: 20 + index,
        height: 10,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();
    const path = `${sourceId}.png`;
    await writeFile(join(setup.directory, path), bytes);
    setup.manifest.assets.push({
      sourceId,
      path,
      sha256: checksum(bytes),
      mimeType: "image/png",
    });
  }
  await setup.write();
  const api = applicationApi();
  await setup.sync(api);
  const saved = valueAt(api.materials, sourceId).body;
  assert.deepEqual(saved, {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "assetImage",
          attrs: {
            assetId: "92000000-0000-4000-8000-000000000001",
            sourceSrc: "scene.png",
            alt: "Схема",
            caption: "Подпись",
            imageVariants: {
              wideLight: "92000000-0000-4000-8000-000000000001",
              wideDark: "92000000-0000-4000-8000-000000000002",
              tallLight: "92000000-0000-4000-8000-000000000003",
              tallDark: "92000000-0000-4000-8000-000000000004",
            },
            nodeId: (await import("./markdown.mjs")).sourceUuid(
              "inside-content:one:0",
            ),
          },
        },
      ],
    },
  });
  const repeat = await setup.sync(api);
  assert.equal(repeat.unchanged, 1);
  assert.equal(api.commits, 1);
  assert.equal(
    api.calls.filter((call) => call.path.endsWith("/assets")).length,
    4,
  );
  assert.deepEqual(valueAt(api.materials, sourceId).body, saved);
});

test("v2 quiz survives preview, apply and repeated sync without rendering raw answer keys", async (t) => {
  const setup = await fixture(t);
  setup.manifest.schemaVersion = 2;
  setup.manifest.requiredFeatures = ["quiz-v1", "github-anchors-v1"];
  setup.manifest.selection.taskIds = [];
  const row = itemAt(setup.manifest.materials, 0);
  row.markdown = "RAW ANSWER KEY";
  row.readerBlocks = [
    { kind: "markdown", markdown: "## Раздел\n\nДо вопроса" },
    {
      kind: "quiz",
      id: "question-1",
      promptMarkdown: "Какой результат?",
      correctOptionId: "option-2",
      options: [
        {
          id: "option-1",
          markdown: "Первый",
          explanationMarkdown: "Неверно. Причина",
        },
        {
          id: "option-2",
          markdown: "Второй",
          explanationMarkdown: "Верно. Причина",
        },
      ],
      dontKnow: {
        explanationMarkdown: "Повторите раздел",
        reviewLinks: ["#раздел"],
      },
    },
    { kind: "markdown", markdown: "## Дальше\n\nПосле вопроса" },
  ];
  await setup.write();
  const api = applicationApi();
  await previewRelease(
    join(setup.directory, "package.json"),
    setup.stateDirectory,
    { origin: "http://127.0.0.1:3101", request: api.request, publish: "all" },
  );
  assert.equal(api.materials.size, 0);
  await setup.sync(api);
  const saved = valueAt(api.materials, sourceId).body;
  assert.doesNotMatch(JSON.stringify(saved), /RAW ANSWER KEY/u);
  assert.match(JSON.stringify(saved), /"type":"quiz"/u);
  assert.match(JSON.stringify(saved), /"correctOptionId":"option-2"/u);
  assert.match(JSON.stringify(saved), /После вопроса/u);
  await setup.sync(api);
  assert.deepEqual(valueAt(api.materials, sourceId).body, saved);
});
