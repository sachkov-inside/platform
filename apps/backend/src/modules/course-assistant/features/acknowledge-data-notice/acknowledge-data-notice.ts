import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import { currentDataNoticeVersion } from "../../domain/data-notice.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { readDataNoticeAcknowledgement } from "../../shared/data-notice-acknowledged.js";

export const acknowledgeDataNoticeSchema = z
  .object({ noticeVersion: z.string().min(1).max(64) })
  .strict();

export const dataNoticeAcknowledgementSchema = z
  .object({ version: z.string(), acknowledgedAt: z.iso.datetime() })
  .strict();

export type AcknowledgeDataNoticeResult =
  | {
      readonly ok: true;
      readonly value: z.infer<typeof dataNoticeAcknowledgementSchema>;
    }
  | {
      readonly ok: false;
      readonly error:
        CourseAssistantError | { readonly code: "stale_data_notice" };
    };

/**
 * Фиксирует, что участник прочитал предупреждение о данных той версии, которую ему показали.
 * Повтор сохраняет первое ознакомление.
 */
export async function acknowledgeDataNotice(
  dependencies: CourseAssistantDependencies,
  command: { readonly accountId: string; readonly noticeVersion: string },
): Promise<AcknowledgeDataNoticeResult> {
  const accountId = z.uuid().safeParse(command.accountId);
  const input = acknowledgeDataNoticeSchema.safeParse({
    noticeVersion: command.noticeVersion,
  });
  if (!accountId.success || !input.success) return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  if (input.data.noticeVersion !== currentDataNoticeVersion)
    return { ok: false, error: { code: "stale_data_notice" } };
  try {
    await dependencies.prisma.dataNoticeAcknowledgement.createMany({
      data: [
        {
          accountId: account,
          noticeVersion: currentDataNoticeVersion,
          acknowledgedAt: dependencies.clock(),
        },
      ],
      skipDuplicates: true,
    });
    const acknowledgedAt = await readDataNoticeAcknowledgement(
      dependencies.prisma,
      account,
    );
    if (acknowledgedAt === null)
      throw new Error("Data notice acknowledgement was not stored");
    return {
      ok: true,
      value: {
        version: currentDataNoticeVersion,
        acknowledgedAt: acknowledgedAt.toISOString(),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "acknowledgeDataNotice" },
      error,
      dependencyUnavailable,
    );
  }
}
