import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import {
  linkableRepositorySchema,
  repositoryLinkViewSchema,
} from "../../domain/repository-link.js";
import { connectionStateDigest } from "../../shared/connection-state.js";
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

export const completeRepositoryConnectionSchema = z
  .object({
    state: z.string().regex(/^[\w-]{43}$/u),
    code: z.string().min(1).max(200),
    installationId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const repositoryConnectionOutcomeSchema = z
  .object({
    repositoryLink: repositoryLinkViewSchema.nullable(),
    repositories: z.array(linkableRepositorySchema),
  })
  .strict();

export type CompleteRepositoryConnectionError =
  | CourseAssistantError
  | { readonly code: "data_notice_required" }
  | { readonly code: "invalid_connection" }
  | { readonly code: "installation_not_owned" }
  | { readonly code: "write_access_requested" };

export type CompleteRepositoryConnectionResult =
  | {
      readonly ok: true;
      readonly value: z.infer<typeof repositoryConnectionOutcomeSchema>;
    }
  | { readonly ok: false; readonly error: CompleteRepositoryConnectionError };

/**
 * Возврат из GitHub после установки приложения. `state` действует один раз и только для Account,
 * который начал подключение; владение установкой подтверждает сам GitHub по коду авторизации
 * участника, потому что installation_id в адресе возврата может подставить кто угодно. Установка
 * с одним репозиторием сразу становится Repository Link, из нескольких участник выбирает сам.
 */
export async function completeRepositoryConnection(
  dependencies: CourseAssistantDependencies,
  command: {
    readonly accountId: string;
    readonly state: string;
    readonly code: string;
    readonly installationId: number;
  },
): Promise<CompleteRepositoryConnectionResult> {
  const accountId = z.uuid().safeParse(command.accountId);
  const input = completeRepositoryConnectionSchema.safeParse({
    state: command.state,
    code: command.code,
    installationId: command.installationId,
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
    const now = dependencies.clock();
    const claimed =
      await dependencies.prisma.repositoryConnectionAttempt.updateMany({
        where: {
          accountId: account,
          stateDigest: connectionStateDigest(input.data.state),
          completedAt: null,
          expiresAt: { gt: now },
        },
        data: { completedAt: now },
      });
    if (claimed.count !== 1)
      return { ok: false, error: { code: "invalid_connection" } };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "completeRepositoryConnection" },
      error,
      dependencyUnavailable,
    );
  }

  const verified = await dependencies.github.verifyInstallationOwner({
    code: input.data.code,
    installationId: input.data.installationId,
  });
  if (!verified.ok) {
    switch (verified.reason) {
      case "invalid_code":
        return { ok: false, error: { code: "invalid_connection" } };
      case "not_owner":
        return { ok: false, error: { code: "installation_not_owned" } };
      case "write_access_requested":
        return { ok: false, error: { code: "write_access_requested" } };
      case "dependency_unavailable":
        return dependencyUnavailable;
    }
  }

  try {
    const now = dependencies.clock();
    await dependencies.prisma.gitHubInstallation.upsert({
      where: {
        accountId_installationId: {
          accountId: account,
          installationId: BigInt(input.data.installationId),
        },
      },
      create: {
        accountId: account,
        installationId: BigInt(input.data.installationId),
        githubLogin: verified.login,
        verifiedAt: now,
      },
      update: { githubLogin: verified.login, verifiedAt: now },
    });
    const repositories = await readLinkableRepositories(dependencies, account, [
      input.data.installationId,
    ]);
    if (repositories === undefined) return dependencyUnavailable;
    const [only] = repositories;
    if (repositories.length === 1 && only !== undefined)
      await replaceRepositoryLink(dependencies.prisma, {
        id: randomUUID(),
        accountId: account,
        linkable: only,
        now,
      });
    return {
      ok: true,
      value: {
        repositoryLink:
          repositories.length === 1
            ? await readActiveRepositoryLink(dependencies, account)
            : null,
        repositories: [...repositories],
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "completeRepositoryConnection" },
      error,
      dependencyUnavailable,
    );
  }
}
