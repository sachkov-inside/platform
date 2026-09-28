import type { CourseAssistantPrismaClient } from "../../../infrastructure/prisma/index.js";
import type {
  LinkableRepository,
  RepositoryLinkView,
} from "../domain/repository-link.js";
import { repositoryHtmlUrl } from "../domain/repository-link.js";
import type { GitHubApp } from "../ports/github-app.js";

/**
 * Репозитории, которые открывают установки, подтверждённые этим Account. Отозванную установку
 * список пропускает; сбой GitHub — `undefined`.
 */
export async function readLinkableRepositories(
  dependencies: {
    readonly prisma: Pick<CourseAssistantPrismaClient, "gitHubInstallation">;
    readonly github: GitHubApp;
  },
  accountId: string,
  installationIds?: readonly number[],
): Promise<readonly LinkableRepository[] | undefined> {
  const installations = await dependencies.prisma.gitHubInstallation.findMany({
    where: {
      accountId,
      ...(installationIds === undefined
        ? {}
        : { installationId: { in: installationIds.map(BigInt) } }),
    },
    orderBy: [{ verifiedAt: "asc" }, { installationId: "asc" }],
    select: { installationId: true },
  });
  const linkable: LinkableRepository[] = [];
  for (const { installationId } of installations) {
    const listed = await dependencies.github.listInstallationRepositories(
      Number(installationId),
    );
    if (!listed.ok) {
      if (listed.reason === "dependency_unavailable") return undefined;
      continue;
    }
    for (const repository of listed.repositories) {
      linkable.push({ installationId: Number(installationId), repository });
    }
  }
  return linkable;
}

/** Действующий Repository Link участника с доступом, каким его видит GitHub сейчас. */
export async function readActiveRepositoryLink(
  dependencies: {
    readonly prisma: Pick<CourseAssistantPrismaClient, "repositoryLink">;
    readonly github: GitHubApp;
  },
  accountId: string,
): Promise<RepositoryLinkView | null> {
  const link = await dependencies.prisma.repositoryLink.findFirst({
    where: { accountId, disconnectedAt: null },
  });
  if (link === null) return null;
  const installationId = Number(link.installationId);
  const repositoryId = Number(link.repositoryId);
  const listed =
    await dependencies.github.listInstallationRepositories(installationId);
  return {
    installationId,
    repository: {
      id: repositoryId,
      fullName: link.repositoryFullName,
      htmlUrl: repositoryHtmlUrl(link.repositoryFullName),
    },
    connectedAt: link.connectedAt.toISOString(),
    access: listed.ok
      ? listed.repositories.some(({ id }) => id === repositoryId)
        ? "available"
        : "revoked"
      : listed.reason === "revoked"
        ? "revoked"
        : "unknown",
  };
}

/**
 * Делает репозиторий действующим Repository Link участника. Прежняя связь закрывается и остаётся в
 * истории; тот же репозиторий повторно не переподключается.
 */
export async function replaceRepositoryLink(
  prisma: CourseAssistantPrismaClient,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly linkable: LinkableRepository;
    readonly now: Date;
  },
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const active = await transaction.repositoryLink.findFirst({
      where: { accountId: input.accountId, disconnectedAt: null },
      select: { id: true, installationId: true, repositoryId: true },
    });
    if (
      active !== null &&
      Number(active.installationId) === input.linkable.installationId &&
      Number(active.repositoryId) === input.linkable.repository.id
    )
      return;
    if (active !== null)
      await transaction.repositoryLink.update({
        where: { id: active.id },
        data: { disconnectedAt: input.now },
      });
    await transaction.repositoryLink.create({
      data: {
        id: input.id,
        accountId: input.accountId,
        installationId: BigInt(input.linkable.installationId),
        repositoryId: BigInt(input.linkable.repository.id),
        repositoryFullName: input.linkable.repository.fullName,
        connectedAt: input.now,
      },
    });
  });
}
