import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  lanes,
  MATERIAL_EVENT_LIFETIME_MS,
} from "../../src/infrastructure/notification-transport/wire.js";
import {
  assembleMaterials,
  MaterialAnnouncements,
} from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const ownerId = "72000000-0000-4000-8000-000000000001";
const topicId = "72000000-0000-4000-8000-000000000002";
const authorPolicy = { canManage: (accountId: string) => accountId === ownerId };

function metadata(title: string) {
  return {
    title,
    summary: "Материал для проверки анонса первой публикации.",
    access: "free" as const,
    topicId,
    formatId: "guide",
    tagIds: [],
    seriesIds: [],
  };
}

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("анонс первой публикации материала", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.topic.create({
      data: { id: topicId, slug: "engineering", name: "Engineering" },
    });
  });

  afterAll(async () => {
    await database.dispose();
  });

  function materials() {
    return assembleMaterials({ prisma: database.prisma, authorPolicy });
  }

  async function draft(title: string) {
    const { authoring } = materials();
    const created = value(
      await authoring.createDraft({
        actor: ownerId,
        idempotencyKey: randomUUID(),
        metadata: metadata(title),
        body: representativeDocument("Тело материала."),
      }),
    );
    return created.materialId;
  }

  async function publish(
    materialId: string,
    expectedContentVersion: number,
    title: string,
    publicationState: "published" | "unpublished" = "published",
  ) {
    const { authoring } = materials();
    return authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: randomUUID(),
      materialId,
      expectedContentVersion,
      publicationState,
      metadata: metadata(title),
      body: representativeDocument("Тело материала."),
    });
  }

  function announcementsOf(materialId: string) {
    return database.prisma.materialAnnouncement.findUnique({
      where: { materialId },
    });
  }

  async function announcedOccurrence(materialId: string) {
    const announcement = await announcementsOf(materialId);
    if (announcement === null) throw new Error("announcement expected");
    return announcement;
  }

  function stagedEvents(messageIds: readonly string[]) {
    return database.prisma.materialNotificationOutbox.findMany({
      where: { messageId: { in: [...messageIds] } },
      orderBy: { createdAt: "asc" },
    });
  }

  test("первая публикация сохраняет повод, его revision и строку outbox одной транзакцией", async () => {
    const materialId = await draft("Как мы собираем платформу");
    const published = value(await publish(materialId, 1, "Как мы собираем платформу"));
    expect(published.publicationState).toBe("published");

    const announcement = await announcedOccurrence(materialId);
    expect(announcement).toMatchObject({
      materialId,
      revision: 1,
      title: "Как мы собираем платформу",
      readerPath: "/materials/kak-my-sobiraem-platformu",
    });
    expect(announcement.notAfter.getTime() - announcement.occurredAt.getTime()).toBe(
      MATERIAL_EVENT_LIFETIME_MS,
    );

    const revisions = await database.prisma.materialAnnouncementRevision.findMany({
      where: { announcementRef: announcement.id },
    });
    expect(revisions).toHaveLength(1);
    const staged = await stagedEvents(revisions.map((row) => row.messageId));
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({
      lane: "materials",
      scope: lanes.materials.publisher,
      publishedAt: null,
    });
    // Событие несёт только ссылку на повод: ни тела материала, ни его заголовка в брокере нет.
    const payload: unknown = JSON.parse(staged[0]?.payload ?? "null");
    expect(payload).toEqual({
      contractVersion: "inside.notification-event.v1",
      eventType: "material.published",
      messageId: revisions[0]?.messageId,
      occurrenceRef: announcement.id,
      sourceRef: materialId,
      sourceRevision: 1,
      occurredAt: announcement.occurredAt.toISOString(),
      notAfter: announcement.notAfter.toISOString(),
    });

    const source = await new MaterialAnnouncements({
      prisma: database.prisma,
    }).resolveAnnouncement(payload);
    expect(source).toEqual({
      status: "current",
      event: payload,
      content: { category: "material", kind: "material_published" },
      accountId: null,
      title: "Как мы собираем платформу",
      readerPath: "/materials/kak-my-sobiraem-platformu",
    });
  });

  test("несостоявшаяся публикация не оставляет обещания уведомления", async () => {
    const materialId = await draft("Материал с чужой темой");
    const { authoring } = materials();
    const rejected = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: randomUUID(),
      materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: { ...metadata("Материал с чужой темой"), topicId: randomUUID() },
      body: representativeDocument("Тело материала."),
    });
    expect(rejected.ok).toBe(false);
    expect(await announcementsOf(materialId)).toBeNull();
    expect(
      await database.prisma.material.findUniqueOrThrow({ where: { id: materialId } }),
    ).toMatchObject({ publicationState: "draft", firstPublishedAt: null });
  });

  test("повторное сохранение того же материала не становится второй публикацией", async () => {
    const materialId = await draft("Материал без повторов");
    value(await publish(materialId, 1, "Материал без повторов"));
    const first = await announcedOccurrence(materialId);
    value(await publish(materialId, 2, "Материал без повторов"));
    expect(await announcementsOf(materialId)).toEqual(first);
    expect(
      await database.prisma.materialAnnouncementRevision.count({
        where: { announcementRef: first.id },
      }),
    ).toBe(1);
  });

  test("изменённый заголовок выпускает следующую revision того же повода", async () => {
    const materialId = await draft("Заголовок до правки");
    value(await publish(materialId, 1, "Заголовок до правки"));
    const before = await announcedOccurrence(materialId);
    value(await publish(materialId, 2, "Заголовок после правки"));
    expect(await announcementsOf(materialId)).toMatchObject({
      id: before.id,
      revision: 2,
      title: "Заголовок после правки",
      // Ссылка читателя закреплена первой публикацией и правку заголовка не замечает.
      readerPath: before.readerPath,
      occurredAt: before.occurredAt,
      notAfter: before.notAfter,
    });
    const revisions = await database.prisma.materialAnnouncementRevision.findMany({
      where: { announcementRef: before.id },
      orderBy: { revision: "asc" },
    });
    expect(revisions).toHaveLength(2);
    expect(await stagedEvents(revisions.map((row) => row.messageId))).toHaveLength(2);

    const facet = new MaterialAnnouncements({ prisma: database.prisma });
    // Устаревшая revision перестаёт быть основанием: отправку разрешает только действующая.
    expect(await facet.resolveAnnouncement(revisions[0]?.payload)).toEqual({
      status: "superseded",
    });
    expect(await facet.resolveAnnouncement(revisions[1]?.payload)).toMatchObject({
      status: "current",
      title: "Заголовок после правки",
    });
  });

  test("снятый с публикации материал перестаёт быть поводом", async () => {
    const materialId = await draft("Материал, который снимут");
    value(await publish(materialId, 1, "Материал, который снимут"));
    const announcement = await announcedOccurrence(materialId);
    const current = await database.prisma.materialAnnouncementRevision.findFirstOrThrow(
      { where: { announcementRef: announcement.id }, orderBy: { revision: "desc" } },
    );
    value(await publish(materialId, 2, "Материал, который снимут", "unpublished"));
    const facet = new MaterialAnnouncements({ prisma: database.prisma });
    expect(await facet.resolveAnnouncement(current.payload)).toEqual({
      status: "superseded",
    });
  });

  test("материал, впервые опубликованный до этой поставки, анонса не получает", async () => {
    const materialId = await draft("Материал прежней поставки");
    // Состояние материала до этой поставки: первая публикация уже была, повода не существует.
    const publishedBefore = new Date("2026-01-15T09:00:00.000Z");
    await database.prisma.material.update({
      where: { id: materialId },
      data: {
        slug: "material-prezhney-postavki",
        publicationState: "published",
        firstPublishedAt: publishedBefore,
        publishedAt: publishedBefore,
        publishedBy: ownerId,
      },
    });

    value(await publish(materialId, 1, "Материал прежней поставки снова"));
    value(await publish(materialId, 2, "Материал прежней поставки", "unpublished"));
    value(await publish(materialId, 3, "Материал прежней поставки"));
    expect(await announcementsOf(materialId)).toBeNull();
    // Собственные строки этого материала: чужие поводы соседних проверок сюда не попадают.
    expect(
      await database.prisma.materialNotificationOutbox.count({
        where: { payload: { contains: materialId } },
      }),
    ).toBe(0);
  });

  test("анонс невозможно записать материалу, который ещё не публиковался", async () => {
    const materialId = await draft("Черновик без публикации");
    // Обе границы окна приходят из одного чтения часов, как их считает сам источник.
    const occurredAt = new Date();
    await expect(
      database.prisma.materialAnnouncement.create({
        data: {
          id: randomUUID(),
          materialId,
          revision: 1,
          occurredAt,
          notAfter: new Date(occurredAt.getTime() + MATERIAL_EVENT_LIFETIME_MS),
          title: "Черновик без публикации",
          readerPath: "/materials/chernovik-bez-publikatsii",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      }),
    ).rejects.toThrow(/publication announcement requires a published Material/u);
  });

  test("чужой и неизвестный повод не открывают отправку", async () => {
    const facet = new MaterialAnnouncements({ prisma: database.prisma });
    const unknownOccurredAt = new Date();
    expect(await facet.resolveAnnouncement({ contractVersion: "other" })).toEqual({
      status: "superseded",
    });
    expect(
      await facet.resolveAnnouncement({
        contractVersion: "inside.notification-event.v1",
        eventType: "material.published",
        messageId: randomUUID(),
        occurrenceRef: randomUUID(),
        sourceRef: randomUUID(),
        sourceRevision: 1,
        occurredAt: unknownOccurredAt.toISOString(),
        notAfter: new Date(
          unknownOccurredAt.getTime() + MATERIAL_EVENT_LIFETIME_MS,
        ).toISOString(),
      }),
    ).toEqual({ status: "superseded" });
  });
});
