import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";

export const repositoryDisconnectionSchema = z
  .object({ disconnected: z.boolean() })
  .strict();

export type DisconnectRepositoryResult =
  | {
      readonly ok: true;
      readonly value: z.infer<typeof repositoryDisconnectionSchema>;
    }
  | { readonly ok: false; readonly error: CourseAssistantError };

/**
 * Отключает Repository Link. Связь остаётся в истории, установка на GitHub не трогается: удалить
 * приложение участник может в настройках GitHub.
 */
export async function disconnectRepository(
  dependencies: CourseAssistantDependencies,
  command: { readonly accountId: string },
): Promise<DisconnectRepositoryResult> {
  const accountId = z.uuid().safeParse(command.accountId);
  if (!accountId.success) return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  try {
    const closed = await dependencies.prisma.repositoryLink.updateMany({
      where: { accountId: account, disconnectedAt: null },
      data: { disconnectedAt: dependencies.clock() },
    });
    return { ok: true, value: { disconnected: closed.count > 0 } };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "disconnectRepository" },
      error,
      dependencyUnavailable,
    );
  }
}
