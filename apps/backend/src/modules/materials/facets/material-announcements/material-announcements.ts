import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { NotificationSource } from "../../../notifications/index.js";
import { announcementEventSchema } from "../../domain/announcement.js";

interface Dependencies {
  readonly prisma: MaterialsPrismaClient;
}

/**
 * Первая публикация материала для общей системы уведомлений: запись анонса принадлежит самой
 * публикации, а этот фасет отвечает на вопрос «анонс ещё актуален?» перед раскрытием аудитории и
 * перед каждой внешней отправкой. Форма ответа, шаблон, каналы и отправка принадлежат
 * Notifications; здесь нет ни тела материала, ни права доступа к нему.
 */
export class MaterialAnnouncements {
  constructor(private readonly dependencies: Dependencies) {}

  async resolveAnnouncement(input: unknown): Promise<NotificationSource> {
    const parsed = announcementEventSchema.safeParse(input);
    if (!parsed.success) return { status: "superseded" };
    const event = parsed.data;
    const { prisma } = this.dependencies;
    try {
      const announcement = await prisma.materialAnnouncement.findUnique({
        where: { id: event.occurrenceRef },
      });
      // Событие принадлежит анонсу целиком: чужой анонс и чужой материал не сверяются.
      if (announcement === null || announcement.materialId !== event.sourceRef) {
        return { status: "superseded" };
      }
      const current = await prisma.materialAnnouncementRevision.findUnique({
        where: {
          announcementRef_revision: {
            announcementRef: announcement.id,
            revision: announcement.revision,
          },
        },
      });
      if (current === null || current.messageId !== event.messageId) {
        return { status: "superseded" };
      }
      // Сохранённая revision — источник истины события; нечитаемая не может быть актуальной.
      const stored = announcementEventSchema.safeParse(current.payload);
      if (!stored.success) return { status: "superseded" };
      const material = await prisma.material.findUnique({
        where: { id: announcement.materialId },
        select: { publicationState: true },
      });
      // Снятый с публикации материал перестаёт быть поводом: читателю нечего открыть.
      if (material?.publicationState !== "published") {
        return { status: "superseded" };
      }
      return {
        status: "current",
        event: stored.data,
        content: { category: "material", kind: "material_published" },
        accountId: null,
        title: announcement.title,
        readerPath: announcement.readerPath,
      };
    } catch {
      return { status: "unavailable" };
    }
  }
}
