import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  assembleMaterials,
  ProductDirectory,
} from "../../src/modules/materials/index.js";
import { assembleApplySourceTask } from "../../src/modules/product-tasks/features/import-product-task/import-product-task.js";
import { assembleReadSourceTaskState } from "../../src/modules/product-tasks/features/read-source-task-state/read-source-task-state.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const outsider = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const firstCommit = "1".repeat(40);
const secondCommit = "2".repeat(40);
const metadata = {
  title: "Imported",
  summary: "Imported lesson",
  access: "free" as const,
  difficulty: null,
  outcomes: [],
  topicId: null,
  formatId: "note" as const,
  tagIds: [],
  seriesIds: [] as string[],
};
const taskDefinition = {
  schemaVersion: 1 as const,
  situation: "Новичок неделю ждёт доступов.",
  result: ["Новичок получает доступ."],
  freedom: "Стек выбирает участник.",
  reviewGuidance: "Проверь выдачу доступа.",
  criteria: [
    {
      id: "access",
      level: "required" as const,
      requirement: "Доступ выдаётся через платформу.",
      acceptableEvidence: ["Ответ GitHub после выдачи."],
    },
  ],
};

describe("source state reads for authoring delivery (#1672)", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
  });
  afterAll(async () => {
    await database.dispose();
  });

  test("Materials state lists one namespace with memberships and follows the recorded source commit", async () => {
    const { authoring } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "State topic",
      slug: "state-topic",
      summary: "",
    });
    if (!topic.ok) throw new Error(topic.error.code);
    const productId = randomUUID();
    const chapterId = randomUUID();
    await database.prisma.product.create({
      data: {
        id: productId,
        slug: "state-product",
        name: "State product",
        sourceId: "inside-content:product",
      },
    });
    await database.prisma.productChapter.create({
      data: { id: chapterId, productId, name: "Глава 1", ordinal: 1 },
    });

    const source = {
      id: "inside-content:lesson",
      path: "course/lesson.md",
      revision: "a".repeat(64),
      showInFeed: false,
      commit: firstCommit,
    };
    const reserved = await authoring.reserveSourceMaterial({ actor, source });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const materialId = reserved.value.materialId;
    // Excluded rows: another namespace, a namespace that only shares the text prefix, no source.
    for (const id of ["other-ns:lesson", "inside-content-extra:lesson"]) {
      const other = await authoring.reserveSourceMaterial({
        actor,
        source: { ...source, id },
      });
      expect(other).toMatchObject({ ok: true });
    }
    const ordinary = await authoring.createDraft({
      actor,
      idempotencyKey: "ordinary-draft",
      metadata,
      body: representativeDocument("Ordinary"),
    });
    expect(ordinary).toMatchObject({ ok: true });

    const read = () =>
      authoring.readSourceMaterialState({ actor, namespace: "inside-content" });
    expect(await read()).toEqual({
      ok: true,
      value: {
        namespace: "inside-content",
        materials: [
          {
            sourceId: "inside-content:lesson",
            materialId,
            slug: expect.any(String) as unknown,
            contentVersion: 1,
            access: "free",
            publicationState: "draft",
            source: {
              path: "course/lesson.md",
              revision: "a".repeat(64),
              commit: firstCommit,
              showInFeed: false,
            },
            memberships: [],
          },
        ],
      },
    });

    const apply = {
      actor,
      materialId,
      expectedContentVersion: 1,
      idempotencyKey: "apply-with-commit",
      // An uppercase commit is stored in its canonical lowercase spelling.
      source: { ...source, commit: secondCommit.toUpperCase() },
      publicationState: "published" as const,
      primaryVideoId: null,
      metadata: {
        ...metadata,
        topicId: topic.value.id,
        seriesIds: [productId],
      },
      body: representativeDocument("Imported lesson"),
    };
    const applied = await authoring.applySourceMaterial(apply);
    expect(applied).toMatchObject({ ok: true, value: { contentVersion: 2 } });
    // The same key and body replay; the same key with another commit is another request.
    expect(await authoring.applySourceMaterial(apply)).toEqual(applied);
    expect(
      await authoring.applySourceMaterial({
        ...apply,
        source: { ...source, commit: firstCommit },
      }),
    ).toMatchObject({ ok: false, error: { code: "idempotency_key_reused" } });
    await database.prisma.productMembership.update({
      where: { seriesId_materialId: { seriesId: productId, materialId } },
      data: { chapterId },
    });
    expect(await read()).toMatchObject({
      ok: true,
      value: {
        materials: [
          {
            materialId,
            contentVersion: 2,
            publicationState: "published",
            source: { commit: secondCommit },
            memberships: [{ productId, ordinal: 1, chapterId }],
          },
        ],
      },
    });
    expect(await authoring.loadMaterial({ actor, materialId })).toMatchObject({
      ok: true,
      value: { source: { id: source.id, commit: secondCommit } },
    });

    const unpublished = await authoring.transitionSourcePublication({
      actor,
      idempotencyKey: "unpublish",
      sourceId: source.id,
      materialId,
      expectedContentVersion: 2,
      publicationState: "unpublished",
    });
    expect(unpublished).toMatchObject({
      ok: true,
      value: { publicationState: "unpublished" },
    });
    const afterPublication = await read();
    expect(afterPublication).toMatchObject({
      ok: true,
      value: {
        materials: [
          {
            publicationState: "unpublished",
            source: { commit: secondCommit },
          },
        ],
      },
    });

    const { commit: _commit, ...withoutCommit } = source;
    const uncommitted = await authoring.applySourceMaterial({
      ...apply,
      idempotencyKey: "apply-without-commit",
      expectedContentVersion: unpublished.ok
        ? unpublished.value.contentVersion
        : 0,
      publicationState: "unpublished",
      source: withoutCommit,
    });
    expect(uncommitted).toMatchObject({ ok: true });
    expect(await read()).toMatchObject({
      ok: true,
      value: { materials: [{ source: { commit: null } }] },
    });
    expect(await authoring.loadMaterial({ actor, materialId })).toMatchObject({
      ok: true,
      value: { source: { commit: null } },
    });

    expect(
      await authoring.readSourceMaterialState({
        actor: outsider,
        namespace: "inside-content",
      }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(
      await authoring.readSourceMaterialState({
        actor,
        namespace: "inside_content",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_content" } });
    expect(
      await authoring.readSourceMaterialState({
        actor,
        namespace: "missing",
      }),
    ).toEqual({ ok: true, value: { namespace: "missing", materials: [] } });
  });

  test("Task state lists one namespace with placement and the commit of the current Task Version", async () => {
    const productId = randomUUID();
    const chapterId = randomUUID();
    await database.prisma.product.create({
      data: { id: productId, slug: `tasks-${productId}`, name: "Tasks" },
    });
    await database.prisma.productChapter.create({
      data: { id: chapterId, productId, name: "Глава 1", ordinal: 1 },
    });
    const dependencies = {
      prisma: database.prisma,
      directory: new ProductDirectory(database.prisma),
      authorPolicy: { canManage: (id: string) => id === actor },
    };
    const apply = assembleApplySourceTask(dependencies);
    const readState = assembleReadSourceTaskState(dependencies);
    const imports = [
      ["inside-content", "second-task", 2, firstCommit],
      ["inside-content", "first-task", 1, firstCommit],
      ["other-ns", "foreign-task", 3, firstCommit],
    ] as const;
    for (const [namespace, code, position, commit] of imports) {
      const imported = await apply(
        {
          sourceId: `${namespace}:${code}`,
          code,
          productId,
          chapterId,
          position,
          title: `Задание ${code}`,
          access: "free",
          definition: taskDefinition,
          relatedMaterialSourceIds: [],
          afterMaterialSourceId: null,
          publicationState: "published",
          provenance: {
            repository: "sachkov-inside/inside-content",
            commit,
            path: `course/tasks/${code}.yaml`,
          },
          expectedRevision: null,
        },
        { actor, idempotencyKey: randomUUID() },
      );
      if (!imported.ok) throw new Error(imported.error.code);
    }
    // A changed definition makes Task Version 2; the state reads that version's commit.
    const changed = await apply(
      {
        sourceId: "inside-content:first-task",
        code: "first-task",
        productId,
        chapterId,
        position: 1,
        title: "Задание first-task",
        access: "closed",
        definition: { ...taskDefinition, freedom: "Любой стек." },
        relatedMaterialSourceIds: [],
        afterMaterialSourceId: null,
        publicationState: "unpublished",
        provenance: {
          repository: "sachkov-inside/inside-content",
          commit: secondCommit,
          path: "course/tasks/first-task.yaml",
        },
        expectedRevision: 1,
      },
      { actor, idempotencyKey: randomUUID() },
    );
    expect(changed).toMatchObject({
      ok: true,
      value: { currentVersion: 2, revision: 2 },
    });

    const state = await readState({ namespace: "inside-content" }, { actor });
    expect(state).toEqual({
      ok: true,
      value: {
        namespace: "inside-content",
        tasks: [
          {
            sourceId: "inside-content:first-task",
            taskId: expect.any(String) as unknown,
            code: "first-task",
            productId,
            chapterId,
            position: 1,
            afterMaterialSourceId: null,
            programmeVisibility: "standalone",
            embeddedMaterialId: null,
            revision: 2,
            access: "closed",
            publicationState: "unpublished",
            sourceCommit: secondCommit,
          },
          {
            sourceId: "inside-content:second-task",
            taskId: expect.any(String) as unknown,
            code: "second-task",
            productId,
            chapterId,
            position: 2,
            afterMaterialSourceId: null,
            programmeVisibility: "standalone",
            embeddedMaterialId: null,
            revision: 1,
            access: "free",
            publicationState: "published",
            sourceCommit: firstCommit,
          },
        ],
      },
    });
    expect(
      await readState({ namespace: "inside-content" }, { actor: outsider }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(await readState({ namespace: "Inside" }, { actor })).toEqual({
      ok: false,
      error: { code: "invalid_request_shape" },
    });
  });
});
