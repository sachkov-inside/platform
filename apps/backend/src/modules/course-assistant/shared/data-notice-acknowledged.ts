import type { CourseAssistantPrismaClient } from "../../../infrastructure/prisma/index.js";
import { currentDataNoticeVersion } from "../domain/data-notice.js";

/** Знаком ли участник с действующим предупреждением о данных. */
export async function readDataNoticeAcknowledgement(
  prisma: Pick<CourseAssistantPrismaClient, "dataNoticeAcknowledgement">,
  accountId: string,
): Promise<Date | null> {
  const row = await prisma.dataNoticeAcknowledgement.findUnique({
    where: {
      accountId_noticeVersion: {
        accountId,
        noticeVersion: currentDataNoticeVersion,
      },
    },
    select: { acknowledgedAt: true },
  });
  return row?.acknowledgedAt ?? null;
}
