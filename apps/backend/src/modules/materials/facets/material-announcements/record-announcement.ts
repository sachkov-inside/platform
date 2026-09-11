import { randomUUID } from "node:crypto";

import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import {
  announcementEvent,
  announcementWindow,
  sameAnnouncementConditions,
  type AnnouncementOccurrence,
} from "../../domain/announcement.js";
import { stageMaterialsNotification } from "../notification-outbox/notification-outbox.js";

export type AnnouncementOutcome = "announced" | "refreshed" | "unchanged";

/**
 * Вызывается внутри транзакции, которая сохраняет саму публикацию: анонс, его неизменяемая
 * revision и строка outbox фиксируются вместе, поэтому обещание уведомления не может пережить
 * откат публикации, а сбой канала не может отменить публикацию.
 *
 * Анонс создаётся ровно один раз — в той транзакции, где материал публикуется впервые. Материал,
 * опубликованный до этой поставки, анонса не получает: повторная публикация, переименование,
 * перестановка и включение в другое руководство не становятся первой публикацией. Изменившийся
 * заголовок или ссылка живого анонса выпускают следующую revision, чтобы ещё не выданная команда
 * обещала читателю то, что он увидит.
 */
export async function recordMaterialAnnouncement(
  transaction: MaterialsPrisma,
  input: {
    readonly occurrence: AnnouncementOccurrence;
    readonly firstPublication: boolean;
  },
  now: Date,
): Promise<AnnouncementOutcome> {
  const { occurrence } = input;
  const existing = await transaction.materialAnnouncement.findUnique({
    where: { materialId: occurrence.materialId },
  });
  if (existing === null && !input.firstPublication) return "unchanged";
  const window = announcementWindow(occurrence.firstPublishedAt);
  // Просроченный анонс не обновляется: команду с таким сроком потребитель уже не примет.
  if (
    existing !== null &&
    (window.notAfter <= now || sameAnnouncementConditions(existing, occurrence))
  ) {
    return "unchanged";
  }
  const announcementRef = existing?.id ?? randomUUID();
  const revision = (existing?.revision ?? 0) + 1;
  const event = announcementEvent({
    messageId: randomUUID(),
    occurrenceRef: announcementRef,
    sourceRevision: revision,
    occurrence,
  });
  const conditions = {
    revision,
    title: occurrence.title,
    readerPath: occurrence.readerPath,
    updatedAt: now,
  };
  if (existing === null) {
    await transaction.materialAnnouncement.create({
      data: {
        id: announcementRef,
        materialId: occurrence.materialId,
        occurredAt: window.occurredAt,
        notAfter: window.notAfter,
        createdAt: now,
        ...conditions,
      },
    });
  } else {
    await transaction.materialAnnouncement.update({
      where: { id: announcementRef },
      data: conditions,
    });
  }
  await transaction.materialAnnouncementRevision.create({
    data: {
      announcementRef,
      revision,
      messageId: event.messageId,
      payload: event,
      createdAt: now,
    },
  });
  await stageMaterialsNotification(transaction, event);
  return existing === null ? "announced" : "refreshed";
}
