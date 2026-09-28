import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import type { RepositoryLinkView } from "../../domain/repository-link.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { readDataNoticeAcknowledgement } from "../../shared/data-notice-acknowledged.js";
import {
  readActiveRepositoryLink,
  readLinkableRepositories,
  replaceRepositoryLink,
} from "../../shared/repository-access.js";

export const linkRepositorySchema = z
  .object({
    installationId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    repositoryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type LinkRepositoryResult =
  | { readonly ok: true; readonly value: RepositoryLinkView }
  | {
      readonly ok: false;
      readonly error:
        | CourseAssistantError
        | { readonly code: "data_notice_required" }
        | { readonly code: "repository_not_available" };
    };

/**
 * Выбирает или меняет Repository Link. Репозиторий должен открываться установкой, которую этот
 * Account подтвердил сам; чужая установка для него не существует.
 */
export async function linkRepository(
  dependencies: CourseAssistantDependencies,
  command: {
    readonly accountId: string;
    readonly installationId: number;
    readonly repositoryId: number;
  },
): Promise<LinkRepositoryResult> {
  const accountId = z.uuid().safeParse(command.accountId);
  const input = linkRepositorySchema.safeParse({
    installationId: command.installationId,
    repositoryId: command.repositoryId,
  });
  if (!accountId.success || !input.success) return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  try {
    if (
      (await readDataNoticeAcknowledgement(dependencies.prisma, account)) ===
      null
    )
      return { ok: false, error: { code: "data_notice_required" } };
    const repositories = await readLinkableRepositories(dependencies, account, [
      input.data.installationId,
    ]);
    if (repositories === undefined) return dependencyUnavailable;
    const chosen = repositories.find(
      ({ repository }) => repository.id === input.data.repositoryId,
    );
    if (chosen === undefined)
      return { ok: false, error: { code: "repository_not_available" } };
    await replaceRepositoryLink(dependencies.prisma, {
      id: randomUUID(),
      accountId: account,
      linkable: chosen,
      now: dependencies.clock(),
    });
    const link = await readActiveRepositoryLink(dependencies, account);
    if (link === null) throw new Error("Repository Link was not stored");
    return { ok: true, value: link };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "linkRepository" },
      error,
      dependencyUnavailable,
    );
  }
}
