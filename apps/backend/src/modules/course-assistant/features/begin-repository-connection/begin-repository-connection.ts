import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import { repositoryConnectionLifetimeMinutes } from "../../domain/repository-link.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { connectionStateDigest } from "../../shared/connection-state.js";
import { readDataNoticeAcknowledgement } from "../../shared/data-notice-acknowledged.js";

export const repositoryConnectionSchema = z
  .object({ installUrl: z.url() })
  .strict();

export type BeginRepositoryConnectionResult =
  | {
      readonly ok: true;
      readonly value: z.infer<typeof repositoryConnectionSchema>;
    }
  | {
      readonly ok: false;
      readonly error:
        CourseAssistantError | { readonly code: "data_notice_required" };
    };

/**
 * Начинает подключение репозитория: одноразовый `state` связывает возврат из GitHub с этим Account.
 * Хранится только его отпечаток.
 */
export async function beginRepositoryConnection(
  dependencies: CourseAssistantDependencies,
  command: { readonly accountId: string },
): Promise<BeginRepositoryConnectionResult> {
  const accountId = z.uuid().safeParse(command.accountId);
  if (!accountId.success) return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  try {
    if (
      (await readDataNoticeAcknowledgement(dependencies.prisma, account)) ===
      null
    )
      return { ok: false, error: { code: "data_notice_required" } };
    const state = randomBytes(32).toString("base64url");
    const createdAt = dependencies.clock();
    await dependencies.prisma.repositoryConnectionAttempt.create({
      data: {
        id: randomUUID(),
        accountId: account,
        stateDigest: connectionStateDigest(state),
        createdAt,
        expiresAt: new Date(
          createdAt.getTime() + repositoryConnectionLifetimeMinutes * 60_000,
        ),
      },
    });
    return {
      ok: true,
      value: { installUrl: dependencies.github.installationUrl(state) },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "beginRepositoryConnection" },
      error,
      dependencyUnavailable,
    );
  }
}
