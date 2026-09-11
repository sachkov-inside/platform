import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  encodeNotification,
  MATERIAL_LIFETIME_MS,
} from "../../src/infrastructure/notification-transport/wire.js";
import {
  announcementEvent,
  announcementWindow,
  materialReaderPath,
  sameAnnouncementConditions,
} from "../../src/modules/materials/domain/announcement.js";

const materialId = randomUUID();
const firstPublishedAt = new Date("2030-03-01T10:00:00.000Z");
const occurrence = {
  materialId,
  firstPublishedAt,
  title: "Как мы собираем платформу",
  readerPath: materialReaderPath("kak-my-sobiraem-platformu"),
};

describe("анонс первой публикации", () => {
  test("живёт ровно сутки от самой публикации, а не от момента, когда его заметили", () => {
    expect(announcementWindow(firstPublishedAt)).toEqual({
      occurredAt: firstPublishedAt,
      notAfter: new Date(firstPublishedAt.getTime() + MATERIAL_LIFETIME_MS),
    });
  });

  test("собирает событие, которое принимает граница транспорта своей ленты", () => {
    const event = announcementEvent({
      messageId: randomUUID(),
      occurrenceRef: randomUUID(),
      sourceRevision: 1,
      occurrence,
    });
    expect(event).toMatchObject({
      contractVersion: "inside.notification-event.v1",
      eventType: "material.published",
      sourceRef: materialId,
      sourceRevision: 1,
      occurredAt: firstPublishedAt.toISOString(),
      notAfter: new Date(
        firstPublishedAt.getTime() + MATERIAL_LIFETIME_MS,
      ).toISOString(),
    });
    // Ни заголовка, ни ссылки, ни тела материала событие не переносит: их отдаёт сам источник.
    expect(Object.keys(event).sort()).toEqual([
      "contractVersion",
      "eventType",
      "messageId",
      "notAfter",
      "occurredAt",
      "occurrenceRef",
      "sourceRef",
      "sourceRevision",
    ]);
    expect(encodeNotification("materials", event).lane).toBe("materials");
  });

  test("следующая revision того же анонса сохраняет повод и меняет только сообщение", () => {
    const occurrenceRef = randomUUID();
    const first = announcementEvent({
      messageId: randomUUID(),
      occurrenceRef,
      sourceRevision: 1,
      occurrence,
    });
    const second = announcementEvent({
      messageId: randomUUID(),
      occurrenceRef,
      sourceRevision: 2,
      occurrence: { ...occurrence, title: "Как мы собрали платформу" },
    });
    expect(second.occurrenceRef).toBe(first.occurrenceRef);
    expect(second.occurredAt).toBe(first.occurredAt);
    expect(second.notAfter).toBe(first.notAfter);
    expect(second.messageId).not.toBe(first.messageId);
  });

  test("сравнивает ровно то, что обещано читателю", () => {
    expect(sameAnnouncementConditions(occurrence, { ...occurrence })).toBe(true);
    expect(
      sameAnnouncementConditions(occurrence, { ...occurrence, title: "Другой" }),
    ).toBe(false);
    expect(
      sameAnnouncementConditions(occurrence, {
        ...occurrence,
        readerPath: materialReaderPath("drugoi"),
      }),
    ).toBe(false);
  });
});
