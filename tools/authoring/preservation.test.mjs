// @ts-check
import { test } from "node:test";
import { z } from "zod";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonical,
  checksum,
  loadPackage,
  materialRevision,
} from "./package.mjs";
import { convertMarkdown } from "./markdown.mjs";
import { taskChapterId } from "./task-import.mjs";
import { syncLocal } from "./local-sync.mjs";
import {
  isJournalOperation,
  materialApplyRequest,
  parseJournal,
} from "./local-boundaries.mjs";
import {
  applyPreservation,
  previewPreservation,
  preservedManifest,
  preservationState,
} from "./preservation.mjs";
import { targetStateSchema } from "./preservation-state.mjs";
import { reservationBodySchema } from "./test-support.mjs";

const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const productId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** @param {import('node:test').TestContext} t @param {'draft'|'published'} [publication] */
async function fixture(t, publication = "published") {
  const directory = await mkdtemp(join(tmpdir(), "preservation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packagePath = join(directory, "package.json");
  const state = join(directory, "state");
  /** @type {import('./package.mjs').Manifest} */
  const manifest = {
    schemaVersion: 2,
    requiredFeatures: [],
    sourceNamespace: "synthetic",
    selection: {
      productId: null,
      chapterIds: [],
      materialIds: ["one"],
      taskIds: [],
      complete: true,
    },
    products: [],
    assets: [],
    diagnostics: [],
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
  };
  await writeFile(packagePath, canonical(manifest));
  const model = {
    materialId,
    contentVersion: 1,
    primaryVideoId: null,
    cover: null,
    metadata: {
      slug: "one",
      access: "free",
      seriesMemberships:
        /** @type {{seriesId: string; ordinal: number}[]} */ ([]),
    },
    publicationState: /** @type {'draft'|'published'|'unpublished'} */ (
      publication
    ),
    source:
      /** @type {{ id: string; path: string; revision: string; showInFeed: boolean } | null} */ (
        null
      ),
  };
  /** @type {string[]} */
  const writes = [];
  /** @type {import('./target.mjs').LocalTransport} */
  const request = async (path, body) => {
    if (path.endsWith("/environment")) return { mode: "development" };
    if (path === "/authoring/collections?kind=topic") return [];
    if (path === "/authoring/collections?kind=product") return [];
    if (path.endsWith("/validate")) return { valid: true };
    if (path === `/authoring/materials/${materialId}`)
      return structuredClone(model);
    if (path.endsWith("/reserve")) {
      writes.push(path);
      const reservedSource = reservationBodySchema.parse(body).source;
      model.source = {
        id: reservedSource.id,
        path: reservedSource.path,
        revision: "b".repeat(64),
        showInFeed: false,
      };
      return { materialId, contentVersion: model.contentVersion };
    }
    if (path.endsWith("/apply")) {
      const command = materialApplyRequest({ path, body })?.body;
      assert.ok(command);
      assert.equal(command.expectedContentVersion, model.contentVersion);
      writes.push(path);
      model.contentVersion += 1;
      model.metadata.access = command.metadata.access;
      model.source = command.source;
      model.publicationState =
        command.publicationState === "published" ? "published" : "draft";
      return { materialId, contentVersion: model.contentVersion };
    }
    throw new Error(`Unexpected ${path}`);
  };
  await syncLocal(packagePath, state, {
    origin: "stand",
    request,
    publish: publication === "published" ? ["one"] : [],
  });
  writes.length = 0;
  /** @type {import('./preservation-state.mjs').ReadTargetState} */
  const readState = async () =>
    targetStateSchema.parse({
      materials: [
        {
          sourceId: "synthetic:one",
          materialId,
          contentVersion: model.contentVersion,
          access: model.metadata.access,
          publicationState: model.publicationState,
        },
      ],
      tasks: [],
    });
  const first = manifest.materials[0];
  assert.ok(first);
  first.access = "closed";
  first.markdown = "Changed explanation";
  await writeFile(packagePath, canonical(manifest));
  return {
    directory,
    packagePath,
    state,
    manifest,
    request,
    readState,
    writes,
    model,
  };
}

for (const publication of /** @type {const} */ (["draft", "published"])) {
  test(`content-only preservation keeps existing ${publication} Material policy`, async (t) => {
    const f = await fixture(t, publication);
    const original = await readFile(f.packagePath, "utf8");
    const result = await previewPreservation(f.packagePath, f.state, {
      sourceCommit: "a".repeat(40),
      readState: f.readState,
      request: f.request,
    });
    assert.equal(f.writes.length, 0);
    const pkg = await loadPackage(result.receipt.packagePath);
    assert.equal(pkg.manifest.materials[0]?.access, "free");
    assert.equal(result.preview.preview.materials[0]?.publication, publication);
    const applied = await applyPreservation(result.path, f.state, {
      readState: f.readState,
      request: f.request,
    });
    assert.equal(f.model.metadata.access, "free");
    assert.equal(f.model.publicationState, publication);
    const before = applied.proof.before.materials[0];
    assert.ok(before);
    assert.equal(
      applied.proof.after.materials[0]?.contentVersion,
      before.contentVersion + 1,
    );
    assert.equal(await readFile(f.packagePath, "utf8"), original);
    assert.equal(f.writes.filter((path) => path.endsWith("/apply")).length, 1);
  });
}

test("target policy drift fails before release writes even when version does not change", async (t) => {
  const f = await fixture(t);
  const result = await previewPreservation(f.packagePath, f.state, {
    sourceCommit: "a".repeat(40),
    readState: f.readState,
    request: f.request,
  });
  f.model.metadata.access = "closed";
  await assert.rejects(
    applyPreservation(result.path, f.state, {
      readState: f.readState,
      request: f.request,
    }),
    /state changed/u,
  );
  assert.deepEqual(f.writes, []);
});

test("unknown identities and unpublished Materials fail without writes", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    previewPreservation(f.packagePath, f.state, {
      sourceCommit: "a".repeat(40),
      readState: async () => ({ materials: [], tasks: [] }),
      request: f.request,
    }),
    /unique fresh identity/u,
  );
  f.model.publicationState = "unpublished";
  await assert.rejects(
    previewPreservation(f.packagePath, f.state, {
      sourceCommit: "a".repeat(40),
      readState: f.readState,
      request: f.request,
    }),
    /unpublished Material/u,
  );
  assert.deepEqual(f.writes, []);
});

test("Task derivation preserves target access/publication without mutating source definitions", async (t) => {
  const f = await fixture(t);
  f.manifest.tasks = [
    {
      sourceId: "task-one",
      productId: "course",
      chapterId: "chapter",
      title: "Task",
      access: "closed",
      definition: { intro: "Unchanged criteria" },
      relatedMaterialIds: [],
      publicationState: "published",
      provenance: {
        repository: "synthetic/content",
        commit: "a".repeat(40),
        path: "task.md",
      },
    },
  ];
  const before = structuredClone(f.manifest);
  const state = await f.readState([], []);
  state.tasks.push({
    sourceId: "synthetic:task-one",
    taskId,
    code: "task-one",
    productId,
    revision: 3,
    access: "free",
    publicationState: "unpublished",
  });
  const derived = preservedManifest(f.manifest, state);
  assert.equal(derived.tasks?.[0]?.access, "free");
  assert.equal(derived.tasks?.[0]?.publicationState, "unpublished");
  assert.deepEqual(
    derived.tasks?.[0]?.definition,
    before.tasks?.[0]?.definition,
  );
  assert.deepEqual(f.manifest, before);
  // An API Task with another source binding cannot satisfy the preservation boundary.
  const send = /** @type {import('./target.mjs').LocalTransport} */ (
    async (path, body) => {
      if (path === "/authoring/collections?kind=product")
        return [
          {
            id: productId,
            slug: "course",
            sourceId: "synthetic:course",
            name: "Course",
            summary: "",
            version: 1,
          },
        ];
      if (path === "/authoring/import/tasks/validate")
        return {
          valid: true,
          current: {
            taskId: materialId,
            code: "task-one",
            revision: 3,
            currentVersion: 1,
            definitionDigest: "b".repeat(64),
            publicationState: "unpublished",
          },
        };
      return f.request(path, body);
    }
  );
  await assert.rejects(
    preservationState(f.manifest, f.state, "stand", async () => state, send),
    /Task API\/database state differs/u,
  );
  assert.deepEqual(f.writes, []);
});

test("pending operations stop before release reconciliation", async (t) => {
  const f = await fixture(t);
  const journalPath = join(f.state, "journal.json");
  const journal = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
  const previous = Object.entries(journal.operations).find(([, entry]) =>
    isJournalOperation(entry),
  );
  assert.ok(previous);
  assert.ok(isJournalOperation(previous[1]));
  journal.operations[previous[0]] = {
    status: "pending",
    request: previous[1].request,
  };
  await writeFile(journalPath, canonical(journal));
  await assert.rejects(
    previewPreservation(f.packagePath, f.state, {
      sourceCommit: "a".repeat(40),
      readState: f.readState,
      request: f.request,
    }),
    /pending release operations/u,
  );
  assert.deepEqual(f.writes, []);
});

test("API and database disagreement stop before writes", async (t) => {
  const f = await fixture(t);
  const readState = async () => {
    const state = await f.readState([], []);
    const first = state.materials[0];
    assert.ok(first);
    first.access = "closed";
    return state;
  };
  await assert.rejects(
    previewPreservation(f.packagePath, f.state, {
      sourceCommit: "a".repeat(40),
      readState,
      request: f.request,
    }),
    /API\/database\/journal state differs/u,
  );
  assert.deepEqual(f.writes, []);
});

test("legacy Practice publication cannot pass through the preservation profile", async (t) => {
  const f = await fixture(t);
  const first = f.manifest.materials[0];
  assert.ok(first);
  f.manifest.practiceDefinitions = [
    {
      practiceId: "synthetic:one",
      definition: { title: "Legacy Practice" },
      sourceReference: {
        materialSourceId: "synthetic:one",
        materialSourceRevision: materialRevision(f.manifest, first),
      },
      provenance: {
        repository: "synthetic/content",
        commit: "a".repeat(40),
        path: "one.practice.json",
      },
      publicationState: "unpublished",
    },
  ];
  await writeFile(f.packagePath, canonical(f.manifest));
  await assert.rejects(
    previewPreservation(f.packagePath, f.state, {
      sourceCommit: "a".repeat(40),
      readState: f.readState,
      request: f.request,
    }),
    /Legacy Practice definitions/u,
  );
  assert.deepEqual(f.writes, []);
});

test("bounded preservation retains embedded Task context and writes only the selected lesson", async (t) => {
  const f = await fixture(t);
  const lesson = f.manifest.materials[0];
  assert.ok(lesson);
  f.manifest.requiredFeatures = ["bounded-content-v1", "material-task-v1"];
  f.manifest.selection.contentOnly = {
    materialIds: ["one"],
    taskIds: [],
    artifactIds: [],
  };
  f.manifest.selection.materialIds.push("untouched");
  f.manifest.selection.taskIds = ["embedded"];
  f.manifest.materials.push({
    ...structuredClone(lesson),
    sourceId: "untouched",
    sourcePath: "untouched.md",
    markdown: "Never import this changed context",
  });
  f.model.metadata.seriesMemberships = [{ seriesId: productId, ordinal: 1 }];
  lesson.practiceTaskId = "embedded";
  lesson.markdown = "Changed [task](embedded.md) and [context](untouched.md).";
  lesson.links = { "embedded.md": "embedded", "untouched.md": "untouched" };
  f.manifest.tasks = [
    {
      sourceId: "embedded",
      productId: "course",
      chapterId: "chapter",
      title: "Context task",
      access: null,
      page: {
        ...structuredClone(lesson),
        sourceId: "embedded",
        sourcePath: "embedded.md",
        markdown: "Task page",
        links: {},
      },
      definition: { intro: "Unchanged criteria" },
      relatedMaterialIds: ["one"],
      programmeVisibility: "embedded",
      publicationState: "unpublished",
      provenance: {
        repository: "synthetic/content",
        commit: "a".repeat(40),
        path: "embedded.md",
      },
    },
  ];
  delete f.manifest.tasks[0]?.page?.practiceTaskId;
  f.manifest.products = [
    {
      sourceId: "course",
      slug: "course",
      title: "Changed product name must not transfer",
      summary: "Changed page",
      complete: true,
      materialIds: ["one", "untouched"],
      supplementaryMaterialIds: [],
      chapters: [
        {
          sourceId: "chapter",
          title: "Changed chapter",
          summary: "Changed",
          materialIds: ["one", "untouched"],
        },
      ],
    },
  ];
  const journalPath = join(f.state, "journal.json");
  const journal = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
  journal.materials["synthetic:untouched"] = {
    materialId: taskId,
    contentVersion: 7,
    digest: "c".repeat(64),
    url: "/materials/untouched",
  };
  await writeFile(journalPath, canonical(journal));
  await writeFile(f.packagePath, canonical(f.manifest));
  /** @type {{path: string; body: unknown}[]} */
  const requests = [];
  const request = /** @type {import('./target.mjs').LocalTransport} */ (
    async (path, body) => {
      requests.push({ path, body });
      if (path === "/authoring/collections?kind=product")
        return [
          {
            id: productId,
            sourceId: "synthetic:course",
            slug: "real-course",
            name: "Original product",
            summary: "Original",
            version: 5,
          },
        ];
      return f.request(path, body);
    }
  );
  const readState =
    /** @type {import('./preservation-state.mjs').ReadTargetState} */ (
      async (materials, tasks) => {
        assert.deepEqual(materials, ["synthetic:one"]);
        assert.deepEqual(tasks, []);
        return f.readState(materials, tasks);
      }
    );
  const preview = await previewPreservation(f.packagePath, f.state, {
    sourceCommit: "a".repeat(40),
    readState,
    request,
  });
  assert.deepEqual(
    preview.preview.preview.contentOnly,
    f.manifest.selection.contentOnly,
  );
  assert.deepEqual(preview.preview.preview.products, []);
  assert.deepEqual(preview.preview.preview.tasks ?? [], []);
  assert.deepEqual(preview.preview.preview.archiveProposals, []);
  const context = (await loadPackage(preview.receipt.packagePath)).manifest;
  assert.equal(context.tasks?.[0]?.access, null);
  assert.equal(context.materials.length, 2);
  assert.equal(
    requests.some((row) => row.path.includes("tasks/validate")),
    false,
  );
  await applyPreservation(preview.path, f.state, { readState, request });
  assert.equal(f.model.metadata.access, "free");
  assert.equal(f.model.publicationState, "published");
  assert.deepEqual(f.writes, ["/authoring/import/materials/apply"]);
  const applied = requests.filter(
    (row) => row.path === "/authoring/import/materials/apply",
  );
  assert.equal(applied.length, 1);
  assert.match(
    JSON.stringify(applied[0]?.body),
    /\/products\/real-course\/tasks\/embedded/u,
  );
  assert.match(JSON.stringify(applied[0]?.body), /\/materials\/untouched/u);
  assert.equal(
    requests.some((row) =>
      /products\/(reserve|update|composition)|artifacts|progress|tasks\/(apply|validate)/u.test(
        row.path,
      ),
    ),
    false,
  );
  const after = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
  assert.deepEqual(
    after.materials["synthetic:untouched"],
    journal.materials["synthetic:untouched"],
  );
});

for (const invalid of [
  "unknown",
  "duplicate",
  "artifacts",
  "empty",
  "missing-feature",
]) {
  test(`bounded selection rejects ${invalid} before transport`, async (t) => {
    const f = await fixture(t);
    f.manifest.requiredFeatures =
      invalid === "missing-feature" ? [] : ["bounded-content-v1"];
    f.manifest.selection.contentOnly = {
      materialIds: ["one"],
      taskIds: [],
      artifactIds: [],
    };
    if (invalid === "unknown")
      f.manifest.selection.contentOnly.materialIds = ["missing"];
    if (invalid === "duplicate")
      f.manifest.selection.contentOnly.materialIds = ["one", "one"];
    if (invalid === "artifacts")
      f.manifest.selection.contentOnly.artifactIds = ["file"];
    if (invalid === "empty") f.manifest.selection.contentOnly.materialIds = [];
    await writeFile(f.packagePath, canonical(f.manifest));
    await assert.rejects(
      previewPreservation(f.packagePath, f.state, {
        sourceCommit: "a".repeat(40),
        readState: f.readState,
        request: async () => {
          assert.fail("No transport before selection validation");
        },
      }),
    );
    assert.deepEqual(f.writes, []);
  });
}

test("bounded preview refuses a selected Material membership change before writes", async (t) => {
  const f = await fixture(t);
  f.manifest.requiredFeatures = ["bounded-content-v1"];
  f.manifest.selection.contentOnly = {
    materialIds: ["one"],
    taskIds: [],
    artifactIds: [],
  };
  // Source context omits a Product that still owns the selected Material on target.
  f.model.metadata.seriesMemberships = [{ seriesId: productId, ordinal: 1 }];
  await writeFile(f.packagePath, canonical(f.manifest));
  await assert.rejects(
    previewPreservation(f.packagePath, f.state, {
      sourceCommit: "a".repeat(40),
      readState: f.readState,
      request: f.request,
    }),
    /refuses Product membership changes/u,
  );
  assert.deepEqual(f.writes, []);
});

test("bounded Task preservation refuses placement drift before writes", async (t) => {
  const f = await fixture(t);
  const task = {
    sourceId: "task-one",
    productId: "course",
    chapterId: "chapter",
    title: "Task",
    access: /** @type {const} */ ("free"),
    definition: { intro: "Unchanged criteria" },
    relatedMaterialIds: [],
    publicationState: /** @type {const} */ ("published"),
    provenance: {
      repository: "synthetic/content",
      commit: "a".repeat(40),
      path: "task.md",
    },
  };
  f.manifest.tasks = [task];
  f.manifest.selection.contentOnly = {
    materialIds: [],
    taskIds: ["task-one"],
    artifactIds: [],
  };
  const current = {
    sourceId: "synthetic:task-one",
    taskId,
    code: "task-one",
    productId,
    chapterId: taskChapterId(f.manifest, task),
    position: 2,
    afterMaterialSourceId: null,
    programmeVisibility: /** @type {const} */ ("standalone"),
    embeddedMaterialId: null,
    revision: 3,
    access: /** @type {const} */ ("free"),
    publicationState: /** @type {const} */ ("published"),
  };
  const readState = async () => ({ materials: [], tasks: [current] });
  const request = /** @type {import('./target.mjs').LocalTransport} */ (
    async (path, body) => {
      if (path === "/authoring/collections?kind=product")
        return [
          {
            id: productId,
            slug: "course",
            sourceId: "synthetic:course",
            name: "Course",
            summary: "",
            version: 1,
          },
        ];
      if (path === "/authoring/import/tasks/validate")
        return {
          valid: true,
          current: {
            taskId,
            code: "task-one",
            revision: 3,
            currentVersion: 1,
            definitionDigest: "b".repeat(64),
            publicationState: "published",
          },
        };
      return f.request(path, body);
    }
  );
  await assert.rejects(
    preservationState(f.manifest, f.state, "stand", readState, request),
    /refuses Task placement changes/u,
  );
  current.position = 1;
  await preservationState(f.manifest, f.state, "stand", readState, request);
  assert.deepEqual(f.writes, []);
});

test("preservation uses the legacy Material wire shape when source omits notification intent", async (t) => {
  const f = await fixture(t);
  const request = /** @type {import('./target.mjs').LocalTransport} */ (
    async (path, body, key, options) => {
      if (path === "/authoring/import/materials/apply") {
        const command = materialApplyRequest({ path, body })?.body;
        assert.ok(command);
        // The running pre-notification DTO rejects extra keys with HTTP 400 at the root.
        if (Object.hasOwn(command, "notifyTelegram"))
          throw Object.assign(
            new Error("400 invalid_request_shape: unrecognized_keys at /"),
            { status: 400 },
          );
      }
      return f.request(path, body, key, options);
    }
  );
  const result = await previewPreservation(f.packagePath, f.state, {
    sourceCommit: "a".repeat(40),
    readState: f.readState,
    request,
  });
  assert.equal(
    Object.hasOwn(result.preview.preview.materials[0] ?? {}, "notifyTelegram"),
    false,
  );
  // Preserve an old client's definitively rejected command without deleting history.
  const journalPath = join(f.state, "journal.json");
  const journal = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
  const applied = Object.values(journal.operations).find(
    (entry) =>
      isJournalOperation(entry) &&
      materialApplyRequest(entry.request) !== undefined,
  );
  assert.ok(applied && isJournalOperation(applied));
  const legacy = structuredClone(applied.request);
  const previous = materialApplyRequest(legacy);
  assert.ok(previous);
  previous.body["notifyTelegram"] = false;
  const derived = await loadPackage(result.receipt.packagePath);
  const selected = derived.manifest.materials[0];
  assert.ok(selected);
  previous.body.source.revision = materialRevision(derived.manifest, selected);
  previous.body.expectedContentVersion = f.model.contentVersion;
  previous.body.body = z
    .object({ schemaVersion: z.number(), doc: z.json() })
    .parse(
      convertMarkdown(selected.markdown, {
        sourceId: `${derived.manifest.sourceNamespace}:${selected.sourceId}`,
        sourcePath: selected.sourcePath,
        link: (href) => href,
        image: (src) => src,
      }),
    );
  const rejectedKey = `authoring:${checksum(canonical(previous))}`;
  journal.operations[rejectedKey] = {
    request: previous,
    status: "rejected",
    error: {
      status: 400,
      message: "400 invalid_request_shape: unrecognized_keys at /",
    },
  };
  await writeFile(journalPath, canonical(journal));
  const before = structuredClone(journal.operations[rejectedKey]);
  await applyPreservation(result.path, f.state, {
    readState: f.readState,
    request,
  });
  const after = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
  assert.deepEqual(after.operations[rejectedKey], before);
  const corrected = structuredClone(previous);
  delete corrected.body["notifyTelegram"];
  const correctedKey = `authoring:${checksum(canonical(corrected))}`;
  const saved = after.operations[correctedKey];
  assert.ok(saved && isJournalOperation(saved));
  assert.equal(saved.status, "applied");
  assert.equal(f.model.contentVersion, 3);
  assert.deepEqual(f.writes, ["/authoring/import/materials/apply"]);
});

for (const notifyTelegram of [false, true]) {
  test(`explicit notification intent ${notifyTelegram} remains on the Material command`, async (t) => {
    const f = await fixture(t);
    const row = f.manifest.materials[0];
    assert.ok(row);
    row.notifyTelegram = notifyTelegram;
    await writeFile(f.packagePath, canonical(f.manifest));
    let observed;
    const request = /** @type {import('./target.mjs').LocalTransport} */ (
      async (path, body, key, options) => {
        if (path === "/authoring/import/materials/apply")
          observed = materialApplyRequest({ path, body })?.body[
            "notifyTelegram"
          ];
        return f.request(path, body, key, options);
      }
    );
    const result = await previewPreservation(f.packagePath, f.state, {
      sourceCommit: "a".repeat(40),
      readState: f.readState,
      request,
    });
    await applyPreservation(result.path, f.state, {
      readState: f.readState,
      request,
    });
    assert.equal(
      result.preview.preview.materials[0]?.notifyTelegram,
      notifyTelegram,
    );
    assert.equal(observed, notifyTelegram);
  });
}
