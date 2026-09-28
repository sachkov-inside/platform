import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import { linkableRepositorySchema } from "../../domain/repository-link.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { readLinkableRepositories } from "../../shared/repository-access.js";

export const linkableRepositoriesSchema = z
  .object({ repositories: z.array(linkableRepositorySchema) })
  .strict();

export type ListLinkableRepositoriesResult =
  | {
      readonly ok: true;
      readonly value: z.infer<typeof linkableRepositoriesSchema>;
    }
  | { readonly ok: false; readonly error: CourseAssistantError };

/** Из каких репозиториев участник может выбрать Repository Link без новой установки. */
export async function listLinkableRepositories(
  dependencies: CourseAssistantDependencies,
  query: { readonly accountId: string },
): Promise<ListLinkableRepositoriesResult> {
  const accountId = z.uuid().safeParse(query.accountId);
  if (!accountId.success) return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  try {
    const repositories = await readLinkableRepositories(dependencies, account);
    return repositories === undefined
      ? dependencyUnavailable
      : { ok: true, value: { repositories: [...repositories] } };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "listLinkableRepositories" },
      error,
      dependencyUnavailable,
    );
  }
}
