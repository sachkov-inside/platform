import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";

const historyLimit = 200;

export const repositoryLinkHistorySchema = z
  .object({
    links: z.array(
      z
        .object({
          accountId: z.uuid(),
          repositoryFullName: z.string(),
          connectedAt: z.iso.datetime(),
          disconnectedAt: z.iso.datetime().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type ListRepositoryLinksResult =
  | {
      readonly ok: true;
      readonly value: z.infer<typeof repositoryLinkHistorySchema>;
    }
  | { readonly ok: false; readonly error: CourseAssistantError };

/**
 * История Repository Link всех участников для автора: кто и когда подключал какой репозиторий.
 * Автор — Account с `platform:admin`; для остальных помощника на этой поверхности нет.
 */
export async function listRepositoryLinks(
  dependencies: CourseAssistantDependencies,
  query: { readonly accountId: string },
): Promise<ListRepositoryLinksResult> {
  const accountId = z.uuid().safeParse(query.accountId);
  if (!accountId.success) return invalidRequest;
  if (!dependencies.settings.enabled) return unavailable;
  const permission = await dependencies.accounts.checkPermission({
    accountId: accountId.data.toLowerCase(),
    permission: "platform:admin",
  });
  if (!permission.ok)
    return permission.error.code === "internal_error"
      ? dependencyUnavailable
      : unavailable;
  if (!permission.allowed) return unavailable;
  try {
    const links = await dependencies.prisma.repositoryLink.findMany({
      orderBy: [{ connectedAt: "desc" }, { id: "asc" }],
      take: historyLimit,
    });
    return {
      ok: true,
      value: {
        links: links.map((link) => ({
          accountId: link.accountId,
          repositoryFullName: link.repositoryFullName,
          connectedAt: link.connectedAt.toISOString(),
          disconnectedAt: link.disconnectedAt?.toISOString() ?? null,
        })),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "listRepositoryLinks" },
      error,
      dependencyUnavailable,
    );
  }
}
