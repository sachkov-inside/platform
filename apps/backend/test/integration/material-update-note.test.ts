import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { authoringImportContract } from "../../src/modules/materials/domain/authoring-import-contract.js";
import {
  assembleMaterialResourceFacts,
  assembleProductMaterialReading,
  PublishedMaterialSelection,
} from "../../src/modules/materials/index.js";
import {
  ProductDiscovery,
  PublishedProductComposition,
} from "../../src/modules/products/index.js";
import {
  PersonalHome,
  ReadingActivity,
} from "../../src/modules/reading-activity/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { everyAccountLinked } from "../support/telegram-links.js";
import { assemblePriorParticipantsFixture } from "./setup/prior-participants.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const actor = randomUUID();
const topicId = randomUUID();
const MINUTE_MS = 60_000;

describe("material update note (#2125)", () => {
  let database: TestDatabase;
  let materials: ReturnType<typeof assembleMaterials>;
  let reading: ReadingActivity;
  let home: PersonalHome;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Updates", slug: "updates" },
    });
    materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const contentAccess = assembleContentAccess({
      telegramLinks: everyAccountLinked,
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      accountRights: assemblePriorParticipantsFixture({
        prisma: database.prisma,
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        clock: () => new Date(),
      }),
      // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
      clock: () => new Date(),
    });
    const composition = new PublishedProductComposition(
      database.prisma,
      assembleProductMaterialReading(database.prisma),
    );
    reading = new ReadingActivity({
      prisma: database.prisma,
      contentAccess,
      materialContent: materials.materialContent,
      composition,
    });
    home = new PersonalHome({
      prisma: database.prisma,
      contentAccess,
      materialContent: materials.materialContent,
      composition,
      reader: materials.publishedMaterialReader,
      selection: new PublishedMaterialSelection({
        prisma: database.prisma,
        products: new ProductDiscovery(database.prisma),
      }),
      videos: {
        loadProgressMany: () =>
          Promise.reject(new Error("not used by this scenario")),
        loadReadyDurations: () =>
          Promise.reject(new Error("not used by this scenario")),
      },
    });
  });
  afterAll(async () => {
    await database.dispose();
  });

  /** Moves the shared virtual clock, so marks, opens and the note get ordered instants. */
  function at(minutes: number) {
    vi.setSystemTime(fixedTestInstant() + minutes * MINUTE_MS);
  }

  async function publishedLesson() {
    const source = {
      id: `inside-content:update-note-${randomUUID()}`,
      path: "lessons/update-note.md",
      revision: "a".repeat(64),
      version: 2 as const,
    };
    const reserved = await materials.authoring.reserveSourceMaterial({
      actor,
      source,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    let contentVersion = reserved.value.contentVersion;
    const materialId = reserved.value.materialId;
    async function apply(input: {
      readonly text: string;
      readonly publicationState?: "published" | "unpublished";
      readonly updateNote?: {
        readonly id: string;
        readonly whatChanged: string;
      };
    }) {
      const result = await materials.authoring.applySourceMaterial({
        actor,
        source,
        materialId,
        expectedContentVersion: contentVersion,
        idempotencyKey: randomUUID(),
        publicationState: input.publicationState ?? "published",
        primaryVideoId: null,
        metadata: {
          title: "Update note lesson",
          summary: "A lesson the author updates",
          access: "free",
          topicId,
          formatId: "note",
          tagIds: [],
          difficulty: null,
          outcomes: [],
          productIds: [],
        },
        body: representativeDocument(input.text),
        ...(input.updateNote === undefined
          ? {}
          : { updateNote: input.updateNote }),
      });
      if (result.ok) contentVersion = result.value.contentVersion;
      return result;
    }
    const first = await apply({ text: "Original" });
    if (!first.ok) throw new Error(first.error.code);
    return { materialId, apply, contentVersion: () => contentVersion };
  }

  async function markRead(accountId: string, materialId: string) {
    const marked = await reading.setReadingState({
      accountId,
      materialId,
      isRead: true,
      expectedVersion: 0,
      commandId: randomUUID(),
    });
    if (!marked.ok) throw new Error(marked.error.code);
  }

  async function open(
    accountId: string,
    materialId: string,
    contentVersion: number,
  ) {
    const opened = await home.recordOpen({
      accountId,
      materialId,
      contentVersion,
      commandId: randomUUID(),
    });
    if (!opened.ok) throw new Error(opened.error.code);
  }

  async function noteFor(accountId: string, materialId: string) {
    const states = await reading.getReadingStates({
      accountId,
      materialIds: [materialId],
    });
    if (!states.ok) throw new Error(states.error.code);
    return states.value[0];
  }

  test("the import contract announces the update note package feature", () => {
    expect(authoringImportContract.packageFeatures).toContain(
      "material-update-note-v1",
    );
  });

  test("a reader who studied the lesson before the noted update sees the note until opening it; the studied mark stays", async () => {
    at(0);
    const lesson = await publishedLesson();
    const studiedBefore = randomUUID();
    const studiedAfter = randomUUID();
    const neverStudied = randomUUID();
    at(1);
    await markRead(studiedBefore, lesson.materialId);
    at(2);
    expect(
      await lesson.apply({
        text: "Rewritten",
        updateNote: {
          id: "2026-11-prompt-assembly",
          whatChanged: "Переписан раздел о сборке промпта.",
        },
      }),
    ).toMatchObject({ ok: true });
    const notedAt = new Date(fixedTestInstant() + 2 * MINUTE_MS).toISOString();
    at(3);
    await markRead(studiedAfter, lesson.materialId);

    expect(await noteFor(studiedBefore, lesson.materialId)).toMatchObject({
      isRead: true,
      updateNote: {
        whatChanged: "Переписан раздел о сборке промпта.",
        notedAt,
      },
    });
    expect(await noteFor(studiedAfter, lesson.materialId)).toMatchObject({
      isRead: true,
      updateNote: null,
    });
    expect(await noteFor(neverStudied, lesson.materialId)).toMatchObject({
      isRead: false,
      updateNote: null,
    });

    at(4);
    await open(studiedBefore, lesson.materialId, lesson.contentVersion());
    expect(await noteFor(studiedBefore, lesson.materialId)).toMatchObject({
      isRead: true,
      updateNote: null,
    });
  });

  test("re-applying the same note keeps its moment and may correct its text; an apply without a note gives no new note", async () => {
    at(0);
    const lesson = await publishedLesson();
    const reader = randomUUID();
    at(1);
    await markRead(reader, lesson.materialId);
    at(2);
    const note = { id: "rag-v2", whatChanged: "Добавлен пример." };
    expect(
      await lesson.apply({ text: "Second", updateNote: note }),
    ).toMatchObject({
      ok: true,
    });
    at(3);
    await open(reader, lesson.materialId, lesson.contentVersion());
    at(4);
    // The package keeps the note between syncs: the same id is the same update.
    expect(
      await lesson.apply({
        text: "Second, typo fixed",
        updateNote: { ...note, whatChanged: "Добавлен пример с ошибкой." },
      }),
    ).toMatchObject({ ok: true });
    expect(await noteFor(reader, lesson.materialId)).toMatchObject({
      updateNote: null,
    });
    const other = randomUUID();
    await markRead(other, lesson.materialId);
    at(5);
    expect(await lesson.apply({ text: "Third, typo only" })).toMatchObject({
      ok: true,
    });
    expect(await noteFor(other, lesson.materialId)).toMatchObject({
      updateNote: null,
    });

    // A reader who studied before the original note sees the corrected text and the original moment.
    const before = randomUUID();
    await database.prisma.readingMaterialState.create({
      data: {
        accountId: before,
        materialId: lesson.materialId,
        isRead: true,
        readAt: new Date(fixedTestInstant() + MINUTE_MS),
        version: 1,
        updatedAt: new Date(fixedTestInstant() + MINUTE_MS),
      },
    });
    expect(await noteFor(before, lesson.materialId)).toMatchObject({
      updateNote: {
        whatChanged: "Добавлен пример с ошибкой.",
        notedAt: new Date(fixedTestInstant() + 2 * MINUTE_MS).toISOString(),
      },
    });

    at(6);
    expect(
      await lesson.apply({
        text: "Fourth",
        updateNote: { id: "rag-v3", whatChanged: "Новая глава." },
      }),
    ).toMatchObject({ ok: true });
    expect(await noteFor(reader, lesson.materialId)).toMatchObject({
      updateNote: { whatChanged: "Новая глава." },
    });
  });

  test("an unpublished lesson shows no note", async () => {
    at(0);
    const lesson = await publishedLesson();
    const reader = randomUUID();
    at(1);
    await markRead(reader, lesson.materialId);
    at(2);
    expect(
      await lesson.apply({
        text: "Withdrawn",
        publicationState: "unpublished",
        updateNote: { id: "withdrawn", whatChanged: "Снят на доработку." },
      }),
    ).toMatchObject({ ok: true });
    expect(await noteFor(reader, lesson.materialId)).toMatchObject({
      isRead: true,
      updateNote: null,
    });
  });

  test("a note outside the package shape is rejected before any write", async () => {
    at(0);
    const lesson = await publishedLesson();
    for (const updateNote of [
      { id: "empty", whatChanged: "   " },
      { id: "", whatChanged: "Текст" },
      { id: "Not-Kebab", whatChanged: "Текст" },
      { id: "a".repeat(65), whatChanged: "Текст" },
      { id: "long", whatChanged: "я".repeat(501) },
      { id: "two-lines", whatChanged: "Первая строка\nвторая" },
    ]) {
      expect(
        await lesson.apply({ text: "Rejected", updateNote }),
      ).toMatchObject({
        ok: false,
        error: { code: "invalid_content" },
      });
    }
    expect(
      await database.prisma.materialUpdateNote.count({
        where: { materialId: lesson.materialId },
      }),
    ).toBe(0);
  });
});
