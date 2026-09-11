import { randomUUID } from "node:crypto";

import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import {
  announcementEvent,
  sameAnnouncementConditions,
  type AnnouncementOccurrence,
} from "../../domain/announcement.js";
import { stageMaterialsNotification } from "../../facets/notification-outbox/notification-outbox.js";

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
): Promise<void> {
  const { occurrence } = input;
  const existing = await transaction.materialAnnouncement.findUnique({
    where: { materialId: occurrence.materialId },
  });
  if (existing === null && !input.firstPublication) return;
  // Просроченный анонс не обновляется: команду с таким сроком потребитель уже не примет.
  if (
    existing !== null &&
    (existing.notAfter <= now || sameAnnouncementConditions(existing, occurrence))
  ) {
    return;
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
    // Срок строки берётся из самого события: у повода и его сообщения одно окно, а не два.
    await transaction.materialAnnouncement.create({
      data: {
        id: announcementRef,
        materialId: occurrence.materialId,
        occurredAt: new Date(event.occurredAt),
        notAfter: new Date(event.notAfter),
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
}
