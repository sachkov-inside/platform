import { z } from "zod";

import { MATERIAL_EVENT_LIFETIME_MS } from "../../../infrastructure/notification-transport/wire.js";
import { normalizedUuidSchema } from "./uuid.js";

/**
 * Первая публикация материала как повод для уведомления. Materials владеет только фактом
 * публикации и её условиями; аудитория, шаблон, канал и отправка принадлежат Notifications
 * по [Notifications v1](../../../../../docs/specifications/notifications-v1.md).
 */

/** Страница читателя, на которую ведёт анонс; origin принадлежит Notifications. */
export function materialReaderPath(slug: string): string {
  return `/materials/${slug}`;
}

/**
 * Выбор полей события своего источника. Полную неизменяемую форму провода проверяет AJV на
 * границе транспорта, поэтому момент здесь читается так же терпимо, как в принятом контракте.
 */
export const announcementEventSchema = z.strictObject({
  contractVersion: z.literal("inside.notification-event.v1"),
  messageId: normalizedUuidSchema,
  occurrenceRef: normalizedUuidSchema,
  sourceRef: normalizedUuidSchema,
  sourceRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.iso.datetime({ offset: true }),
  notAfter: z.iso.datetime({ offset: true }),
  eventType: z.literal("material.published"),
});
export type AnnouncementEvent = z.infer<typeof announcementEventSchema>;

/** Что именно обещано читателю: заголовок объявленного материала и ссылка на него. */
export interface AnnouncementConditions {
  readonly title: string;
  readonly readerPath: string;
}

export interface AnnouncementOccurrence extends AnnouncementConditions {
  readonly materialId: string;
  /** Момент самой первой публикации, а не текущего сохранения. */
  readonly firstPublishedAt: Date;
}

/**
 * Сравнивается всё, что обещано читателю. Ссылка сегодня измениться не может: slug закреплён
 * первой публикацией (`0005_mutable_materials`), — но условие названо здесь целиком, чтобы
 * ослабление того правила не оставило устаревшее обещание без новой revision.
 */
export function sameAnnouncementConditions(
  left: AnnouncementConditions,
  right: AnnouncementConditions,
): boolean {
  return left.title === right.title && left.readerPath === right.readerPath;
}

/**
 * Срок анонса считается от самой публикации: замеченное позже событие не продлевает себе жизнь.
 * Обе границы приходят из одного значения, поэтому потребитель сверяет ровно ту же длительность.
 */
export function announcementWindow(firstPublishedAt: Date): {
  readonly occurredAt: Date;
  readonly notAfter: Date;
} {
  return {
    occurredAt: firstPublishedAt,
    notAfter: new Date(firstPublishedAt.getTime() + MATERIAL_EVENT_LIFETIME_MS),
  };
}

/** Событие описывает конкретную revision анонса: повтор той же revision сохраняет messageId. */
export function announcementEvent(input: {
  readonly messageId: string;
  readonly occurrenceRef: string;
  readonly sourceRevision: number;
  readonly occurrence: AnnouncementOccurrence;
}): AnnouncementEvent {
  const window = announcementWindow(input.occurrence.firstPublishedAt);
  return announcementEventSchema.parse({
    contractVersion: "inside.notification-event.v1",
    messageId: input.messageId,
    occurrenceRef: input.occurrenceRef,
    sourceRef: input.occurrence.materialId,
    sourceRevision: input.sourceRevision,
    occurredAt: window.occurredAt.toISOString(),
    notAfter: window.notAfter.toISOString(),
    eventType: "material.published",
  });
}
