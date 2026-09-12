import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleMaterials } from "../../src/modules/materials/index.js";
import { guideChapterPlacementIssues } from "../../src/modules/materials/features/reorder-series/guide-chapter-placement.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = "89000000-0000-4000-8000-000000000101";
const topicId = "89000000-0000-4000-8000-000000000102";
const formatId = "guide";

const chapterSummary = [
  "Изменение в коде ещё нужно проверить, собрать в релиз и запустить в нужном окружении.",
  "Ты выберешь свой работающий проект, найдёшь команды сборки и настроишь их запуск в CI.",
].join("\n\n");

describe("Guide chapters", () => {
  let testDatabase: TestDatabase;
  let materials: ReturnType<typeof assembleMaterials>;
  let sequence = 0;

  const guide = async (slug: string): Promise<string> => {
    const created = await materials.authoring.createContentCollection({
      actor,
      kind: "guide",
      name: slug,
      slug,
      summary: "",
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  };

  const material = async (
    title: string,
    guideIds: readonly string[],
    publish = true,
  ): Promise<string> => {
    sequence += 1;
    const metadata = {
      access: "free" as const,
      formatId,
      difficulty: null,
      outcomes: [],
      seriesIds: [...guideIds],
      summary: `${title} summary.`,
      tagIds: [],
      title,
      topicId,
    };
    const created = await materials.authoring.createDraft({
      actor,
      idempotencyKey: `guide-chapter-create-${String(sequence)}`,
      metadata,
      body: representativeDocument(`${title} body.`),
    });
    if (!created.ok) throw new Error(created.error.code);
    if (publish) {
      const published = await materials.authoring.saveMaterial({
        actor,
        idempotencyKey: `guide-chapter-publish-${String(sequence)}`,
        materialId: created.value.materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata,
        body: representativeDocument(`${title} body.`),
      });
      if (!published.ok) throw new Error(published.error.code);
    }
    return created.value.materialId;
  };

  const load = async (guideId: string) => {
    const loaded = await materials.authoring.loadSeriesOrder({
      actor,
      seriesId: guideId,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    return loaded.value;
  };

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    materials = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "guide-chapters", name: "Guide chapters" },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("groups the main path into named chapters and keeps a rename identical", async () => {
    const guideId = await guide("infrastructure-releases");
    const first = await material("Проект и CI", [guideId]);
    const second = await material("Образы приложения", [guideId]);
    const third = await material("Публикация релиза", [guideId]);
    const [projectChapter, releaseChapter] = [randomUUID(), randomUUID()];

    const initial = await load(guideId);
    expect(initial.chapters).toEqual([]);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [first, second, third],
      chapters: [
        { id: projectChapter, name: "Проект и CI", summary: chapterSummary },
        { id: releaseChapter, name: "Релизы", summary: "" },
      ],
      chapterAssignments: {
        [first]: projectChapter,
        [second]: releaseChapter,
        [third]: releaseChapter,
      },
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const grouped = await load(guideId);
    expect(grouped.chapters).toEqual([
      { id: projectChapter, name: "Проект и CI", ordinal: 1, summary: chapterSummary },
      { id: releaseChapter, name: "Релизы", ordinal: 2, summary: "" },
    ]);
    expect(grouped.items.map(({ chapterId, materialId }) => [materialId, chapterId])).toEqual([
      [first, projectChapter],
      [second, releaseChapter],
      [third, releaseChapter],
    ]);

    const renamed = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: grouped.orderVersion,
      orderedMaterialIds: [first, second, third],
      chapters: [
        { id: projectChapter, name: "Проект, CI и проверки", summary: chapterSummary },
        { id: releaseChapter, name: "Релизы", summary: "" },
      ],
      chapterAssignments: {
        [first]: projectChapter,
        [second]: releaseChapter,
        [third]: releaseChapter,
      },
    });
    if (!renamed.ok) throw new Error(renamed.error.code);
    const afterRename = await load(guideId);
    expect(afterRename.chapters[0]).toEqual({
      id: projectChapter,
      name: "Проект, CI и проверки",
      ordinal: 1,
      summary: chapterSummary,
    });
    expect(afterRename.items[0]?.chapterId).toBe(projectChapter);
  });

  test("reorders chapters, moves a Material between them and keeps every Material", async () => {
    const guideId = await guide("working-with-agents");
    const first = await material("Основы", [guideId]);
    const second = await material("Первая фича", [guideId]);
    const [basics, feature] = [randomUUID(), randomUUID()];
    const initial = await load(guideId);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [first, second],
      chapters: [
        { id: basics, name: "Основы", summary: "" },
        { id: feature, name: "Первая фича", summary: "" },
      ],
      chapterAssignments: { [first]: basics, [second]: feature },
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const swapped = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: saved.value.orderVersion,
      orderedMaterialIds: [second, first],
      chapters: [
        { id: feature, name: "Первая фича", summary: "" },
        { id: basics, name: "Основы", summary: "" },
      ],
      chapterAssignments: { [second]: feature, [first]: basics },
    });
    if (!swapped.ok) throw new Error(swapped.error.code);
    const afterSwap = await load(guideId);
    expect(afterSwap.chapters.map(({ id, ordinal }) => [id, ordinal])).toEqual([
      [feature, 1],
      [basics, 2],
    ]);

    const moved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: afterSwap.orderVersion,
      orderedMaterialIds: [second, first],
      chapters: [
        { id: feature, name: "Первая фича", summary: "" },
        { id: basics, name: "Основы", summary: "" },
      ],
      chapterAssignments: { [second]: feature, [first]: feature },
    });
    if (!moved.ok) throw new Error(moved.error.code);
    const afterMove = await load(guideId);
    expect(afterMove.items.map(({ chapterId }) => chapterId)).toEqual([feature, feature]);
    expect(afterMove.chapters.map(({ id }) => id)).toEqual([feature, basics]);
    expect(
      await testDatabase.prisma.material.count({ where: { id: { in: [first, second] } } }),
    ).toBe(2);
  });

  test("keeps an empty chapter and detaches Materials when a chapter is removed", async () => {
    const guideId = await guide("job-search");
    const only = await material("Цель поиска", [guideId]);
    const [goal, planned] = [randomUUID(), randomUUID()];
    const initial = await load(guideId);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [only],
      chapters: [
        { id: goal, name: "Цель поиска", summary: "" },
        { id: planned, name: "Переговоры", summary: "Материалы готовятся." },
      ],
      chapterAssignments: { [only]: goal },
    });
    if (!saved.ok) throw new Error(saved.error.code);
    const withEmpty = await load(guideId);
    expect(withEmpty.chapters.map(({ name }) => name)).toEqual(["Цель поиска", "Переговоры"]);

    const removed = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: withEmpty.orderVersion,
      orderedMaterialIds: [only],
      chapters: [{ id: planned, name: "Переговоры", summary: "Материалы готовятся." }],
      chapterAssignments: {},
    });
    if (!removed.ok) throw new Error(removed.error.code);
    const afterRemoval = await load(guideId);
    expect(afterRemoval.chapters.map(({ id }) => id)).toEqual([planned]);
    expect(afterRemoval.items).toMatchObject([{ chapterId: null, materialId: only }]);
    expect(await testDatabase.prisma.material.count({ where: { id: only } })).toBe(1);
  });

  test("keeps chapter placement when the author saves the Material itself", async () => {
    const guideId = await guide("material-save");
    const first = await material("Первый", [guideId]);
    const second = await material("Второй", [guideId]);
    const chapterId = randomUUID();
    const initial = await load(guideId);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [first, second],
      chapters: [{ id: chapterId, name: "Одна глава", summary: "" }],
      chapterAssignments: { [first]: chapterId, [second]: chapterId },
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const loaded = await materials.authoring.loadMaterial({ actor, materialId: first });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const resaved = await materials.authoring.saveMaterial({
      actor,
      idempotencyKey: "guide-chapter-material-resave",
      materialId: first,
      expectedContentVersion: loaded.value.contentVersion,
      publicationState: "published",
      metadata: {
        access: "free" as const,
        formatId,
        difficulty: null,
        outcomes: [],
        seriesIds: [guideId],
        summary: "Первый summary.",
        tagIds: [],
        title: "Первый, изменён",
        topicId,
      },
      body: representativeDocument("Изменённое тело."),
    });
    if (!resaved.ok) throw new Error(resaved.error.code);

    const afterSave = await load(guideId);
    expect(afterSave.items.map(({ chapterId: id }) => id)).toEqual([chapterId, chapterId]);
    expect(afterSave.orderVersion).toBe(saved.value.orderVersion);
  });

  test("adds a Material to a chaptered Guide through Save without breaking a chapter", async () => {
    const guideId = await guide("save-append");
    const first = await material("Первый", [guideId]);
    const second = await material("Второй", [guideId]);
    const chapterId = randomUUID();
    const initial = await load(guideId);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [first, second],
      chapters: [{ id: chapterId, name: "Одна глава", summary: "" }],
      chapterAssignments: { [first]: chapterId, [second]: chapterId },
    });
    if (!saved.ok) throw new Error(saved.error.code);

    // Save may only keep an existing placement or append a new membership; it cannot reposition.
    const appended = await material("Добавлен через Save", [guideId]);
    const afterAppend = await load(guideId);
    expect(afterAppend.items.map(({ chapterId: id, materialId }) => [materialId, id])).toEqual([
      [first, chapterId],
      [second, chapterId],
      [appended, null],
    ]);
    expect(
      guideChapterPlacementIssues(
        afterAppend.items.map(({ materialId }) => materialId),
        Object.fromEntries(
          afterAppend.items.flatMap(({ chapterId: id, materialId }) => (id === null ? [] : [[materialId, id]])),
        ),
        afterAppend.chapters.map(({ id }) => id),
      ),
    ).toEqual([]);
  });

  test("keeps a shared Material in independent chapters of two Guides", async () => {
    const [firstGuide, secondGuide] = await Promise.all([
      guide("shared-first"),
      guide("shared-second"),
    ]);
    const shared = await material("Общий материал", [firstGuide, secondGuide]);
    const [firstChapter, secondChapter] = [randomUUID(), randomUUID()];
    const firstOrder = await load(firstGuide);
    const savedFirst = await materials.authoring.reorderSeries({
      actor,
      seriesId: firstGuide,
      expectedOrderVersion: firstOrder.orderVersion,
      orderedMaterialIds: [shared],
      chapters: [{ id: firstChapter, name: "Подготовка", summary: "" }],
      chapterAssignments: { [shared]: firstChapter },
    });
    if (!savedFirst.ok) throw new Error(savedFirst.error.code);
    const secondOrder = await load(secondGuide);
    const savedSecond = await materials.authoring.reorderSeries({
      actor,
      seriesId: secondGuide,
      expectedOrderVersion: secondOrder.orderVersion,
      orderedMaterialIds: [shared],
      chapters: [{ id: secondChapter, name: "Проверка", summary: "" }],
      chapterAssignments: { [shared]: secondChapter },
    });
    if (!savedSecond.ok) throw new Error(savedSecond.error.code);

    expect((await load(firstGuide)).items[0]?.chapterId).toBe(firstChapter);
    expect((await load(secondGuide)).items[0]?.chapterId).toBe(secondChapter);

    await expect(
      materials.authoring.reorderSeries({
        actor,
        seriesId: firstGuide,
        expectedOrderVersion: savedFirst.value.orderVersion,
        orderedMaterialIds: [shared],
        chapters: [{ id: secondChapter, name: "Чужая глава", summary: "" }],
        chapterAssignments: { [shared]: secondChapter },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "guide_chapter_claimed", path: "/chapters/0/id" }],
      },
    });
  });

  test("rejects a split chapter, an out-of-order chapter and an unknown chapter", async () => {
    const guideId = await guide("invalid-placement");
    const first = await material("Первый", [guideId]);
    const second = await material("Второй", [guideId]);
    const third = await material("Третий", [guideId]);
    const [alpha, beta] = [randomUUID(), randomUUID()];
    const initial = await load(guideId);
    const chapters = [
      { id: alpha, name: "Альфа", summary: "" },
      { id: beta, name: "Бета", summary: "" },
    ];

    await expect(
      materials.authoring.reorderSeries({
        actor,
        seriesId: guideId,
        expectedOrderVersion: initial.orderVersion,
        orderedMaterialIds: [first, second, third],
        chapters,
        chapterAssignments: { [first]: alpha, [second]: beta, [third]: alpha },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "guide_chapter_not_continuous", path: "/orderedMaterialIds/2" }],
      },
    });

    await expect(
      materials.authoring.reorderSeries({
        actor,
        seriesId: guideId,
        expectedOrderVersion: initial.orderVersion,
        orderedMaterialIds: [first, second, third],
        chapters,
        chapterAssignments: { [first]: beta, [second]: alpha, [third]: alpha },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "guide_chapter_out_of_order", path: "/chapters/1" }],
      },
    });

    const unknown = randomUUID();
    await expect(
      materials.authoring.reorderSeries({
        actor,
        seriesId: guideId,
        expectedOrderVersion: initial.orderVersion,
        orderedMaterialIds: [first, second, third],
        chapters,
        chapterAssignments: { [first]: unknown },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "guide_chapter_not_found", path: `/chapterAssignments/${first}` }],
      },
    });

    expect((await load(guideId)).chapters).toEqual([]);
  });

  test("carries chapter placement through a plain reorder and rejects a stale chapter edit", async () => {
    const guideId = await guide("concurrent-chapters");
    const first = await material("Первый", [guideId]);
    const second = await material("Второй", [guideId]);
    const chapterId = randomUUID();
    const initial = await load(guideId);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [first, second],
      chapters: [{ id: chapterId, name: "Одна глава", summary: "" }],
      chapterAssignments: { [first]: chapterId, [second]: chapterId },
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const reordered = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: saved.value.orderVersion,
      orderedMaterialIds: [second, first],
    });
    if (!reordered.ok) throw new Error(reordered.error.code);
    const afterReorder = await load(guideId);
    expect(afterReorder.items.map(({ chapterId: id, materialId }) => [materialId, id])).toEqual([
      [second, chapterId],
      [first, chapterId],
    ]);

    await expect(
      materials.authoring.reorderSeries({
        actor,
        seriesId: guideId,
        expectedOrderVersion: saved.value.orderVersion,
        orderedMaterialIds: [second, first],
        chapters: [{ id: chapterId, name: "Переименована в другой вкладке", summary: "" }],
        chapterAssignments: { [second]: chapterId, [first]: chapterId },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "stale_series_order",
        currentOrderVersion: afterReorder.orderVersion,
      },
    });
  });

  test("keeps chapters editable in an archived Guide and still refuses new Materials", async () => {
    const guideId = await guide("archived-chapters");
    const inside = await material("Внутри", [guideId]);
    const outside = await material("Снаружи", []);
    const chapterId = randomUUID();
    const initial = await load(guideId);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [inside],
      chapters: [{ id: chapterId, name: "До архива", summary: "" }],
      chapterAssignments: { [inside]: chapterId },
    });
    if (!saved.ok) throw new Error(saved.error.code);
    await testDatabase.prisma.guide.update({
      where: { id: guideId },
      data: { archivedAt: new Date() },
    });

    const archived = await load(guideId);
    expect(archived.archived).toBe(true);
    const renamed = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: archived.orderVersion,
      orderedMaterialIds: [inside],
      chapters: [{ id: chapterId, name: "После архива", summary: "Описание." }],
      chapterAssignments: { [inside]: chapterId },
    });
    if (!renamed.ok) throw new Error(renamed.error.code);
    expect((await load(guideId)).chapters).toEqual([
      { id: chapterId, name: "После архива", ordinal: 1, summary: "Описание." },
    ]);

    await expect(
      materials.authoring.reorderSeries({
        actor,
        seriesId: guideId,
        expectedOrderVersion: renamed.value.orderVersion,
        orderedMaterialIds: [inside, outside],
        chapters: [{ id: chapterId, name: "После архива", summary: "Описание." }],
        chapterAssignments: { [inside]: chapterId, [outside]: chapterId },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "series_archived", path: "/orderedMaterialIds/1" }],
      },
    });
  });

  test("publishes the chapter programme without draft Materials", async () => {
    const guideId = await guide("published-programme");
    const published = await material("Опубликованный", [guideId]);
    const draft = await material("Черновик", [guideId], false);
    const [visible, empty] = [randomUUID(), randomUUID()];
    const initial = await load(guideId);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [published, draft],
      chapters: [
        { id: visible, name: "Готовая глава", summary: chapterSummary },
        { id: empty, name: "Пустая глава", summary: "" },
      ],
      chapterAssignments: { [published]: visible, [draft]: visible },
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const programme = await materials.publishedMaterialReader.discoverProjections({
      kind: "series",
      slug: "published-programme",
      first: null,
    });
    if (!programme.ok) throw new Error(programme.error.code);
    // Описание главы объясняет читателю программу на странице продукта, поэтому каталог его несёт.
    // Черновик при этом остаётся невидимым: состав главы содержит только опубликованное.
    expect(programme.value.chapters).toEqual([
      { id: visible, materialIds: [published], name: "Готовая глава", summary: chapterSummary },
      { id: empty, materialIds: [], name: "Пустая глава", summary: "" },
    ]);
    expect(programme.value.items.map(({ materialId }) => materialId)).toEqual([published]);
  });

  test("leaves a flat Guide and every other discovery kind without chapters", async () => {
    const guideId = await guide("flat-guide");
    const only = await material("Единственный", [guideId]);
    const initial = await load(guideId);
    expect(initial.chapters).toEqual([]);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: [only],
    });
    expect(saved).toMatchObject({ ok: true });

    const flat = await materials.publishedMaterialReader.discoverProjections({
      kind: "series",
      slug: "flat-guide",
      first: null,
    });
    if (!flat.ok) throw new Error(flat.error.code);
    expect(flat.value.chapters).toEqual([]);

    const topic = await materials.publishedMaterialReader.discoverProjections({
      kind: "topic",
      slug: "guide-chapters",
      first: 10,
    });
    if (!topic.ok) throw new Error(topic.error.code);
    expect(topic.value.chapters).toEqual([]);
  });

  test("carries a seven-chapter Guide of the size the author already writes", async () => {
    const guideId = await guide("seven-chapters");
    const titles = [
      "Проект и CI",
      "Образы приложения",
      "Публикация и проверка релиза",
      "Окружение и инфраструктура",
      "Первый деплой и защита данных",
      "Обновление приложения",
      "Файлы, почта и видео",
    ];
    const authored = titles.map((title, index) => ({
      id: randomUUID(),
      name: title,
      // The author's real chapters are two or three paragraphs of about a thousand characters.
      summary: [
        `${title}. ${"Разберём, что происходит на этом шаге и почему он нужен именно здесь. ".repeat(4)}`,
        "Ты выполнишь практику на своём проекте и получишь проверяемый результат. ".repeat(4),
        index % 2 === 0 ? "Отдельно посмотрим на альтернативные маршруты и их стоимость. ".repeat(4) : "",
      ]
        .filter((paragraph) => paragraph.length > 0)
        .map((paragraph) => paragraph.trim())
        .join("\n\n"),
    }));
    const composition: string[] = [];
    const assignments: Record<string, string> = {};
    for (const [index, chapter] of authored.entries()) {
      for (let position = 0; position < (index === 6 ? 5 : 3); position += 1) {
        const materialId = await material(`${chapter.name} · ${String(position + 1)}`, [guideId]);
        composition.push(materialId);
        assignments[materialId] = chapter.id;
      }
    }

    const initial = await load(guideId);
    const saved = await materials.authoring.reorderSeries({
      actor,
      seriesId: guideId,
      expectedOrderVersion: initial.orderVersion,
      orderedMaterialIds: composition,
      chapters: authored,
      chapterAssignments: assignments,
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const loaded = await load(guideId);
    expect(loaded.chapters.map(({ name, ordinal }) => [ordinal, name])).toEqual(
      titles.map((title, index) => [index + 1, title]),
    );
    expect(loaded.chapters.every(({ summary }) => summary.split("\n\n").length >= 2)).toBe(true);
    expect(loaded.items).toHaveLength(23);
    expect(loaded.items.map(({ materialId }) => materialId)).toEqual(composition);

    const programme = await materials.publishedMaterialReader.discoverProjections({
      kind: "series",
      slug: "seven-chapters",
      first: null,
    });
    if (!programme.ok) throw new Error(programme.error.code);
    expect(programme.value.chapters.map(({ name }) => name)).toEqual(titles);
    expect(programme.value.chapters.flatMap(({ materialIds }) => materialIds)).toEqual(composition);
    expect(programme.value.chapters.at(-1)?.materialIds).toHaveLength(5);
  });

  test("rejects an unnamed chapter and a description beyond the accepted length", async () => {
    const guideId = await guide("invalid-chapter-content");
    const initial = await load(guideId);
    for (const chapters of [
      [{ id: randomUUID(), name: " ", summary: "" }],
      [{ id: randomUUID(), name: "Глава", summary: "x".repeat(4001) }],
      [
        { id: "not-a-uuid", name: "Глава", summary: "" },
      ],
    ]) {
      await expect(
        materials.authoring.reorderSeries({
          actor,
          seriesId: guideId,
          expectedOrderVersion: initial.orderVersion,
          orderedMaterialIds: [],
          chapters,
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "invalid_content" } });
    }
  });
});
