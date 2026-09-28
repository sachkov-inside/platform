import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import { currentDataNoticeVersion } from "../../domain/data-notice.js";
import { repositoryLinkViewSchema } from "../../domain/repository-link.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { readDataNoticeAcknowledgement } from "../../shared/data-notice-acknowledged.js";
import { readActiveRepositoryLink } from "../../shared/repository-access.js";

export const participantStateSchema = z
  .object({
    dataNotice: z
      .object({
        version: z.string(),
        acknowledgedAt: z.iso.datetime().nullable(),
      })
      .strict(),
    repositoryLink: repositoryLinkViewSchema.nullable(),
  })
  .strict();
export type ParticipantState = z.infer<typeof participantStateSchema>;

export type ReadParticipantStateResult =
  | { readonly ok: true; readonly value: ParticipantState }
  | { readonly ok: false; readonly error: CourseAssistantError };

/** Что участник видит на экране помощника: предупреждение о данных и Repository Link. */
export async function readParticipantState(
  dependencies: CourseAssistantDependencies,
  query: { readonly accountId: string },
): Promise<ReadParticipantStateResult> {
  const accountId = z.uuid().safeParse(query.accountId);
  if (!accountId.success) return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  try {
    const acknowledgedAt = await readDataNoticeAcknowledgement(
      dependencies.prisma,
      account,
    );
    return {
      ok: true,
      value: {
        dataNotice: {
          version: currentDataNoticeVersion,
          acknowledgedAt: acknowledgedAt?.toISOString() ?? null,
        },
        repositoryLink: await readActiveRepositoryLink(dependencies, account),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "readParticipantState" },
      error,
      dependencyUnavailable,
    );
  }
}
