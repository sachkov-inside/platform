import { z } from "zod";

/** Как долго действует начатое подключение: от кнопки до возврата из GitHub. */
export const repositoryConnectionLifetimeMinutes = 15;

const repositorySchema = z
  .object({
    id: z.number().int().positive(),
    fullName: z.string().min(3).max(200),
    htmlUrl: z.url(),
  })
  .strict();

export const linkableRepositorySchema = z
  .object({
    installationId: z.number().int().positive(),
    repository: repositorySchema,
  })
  .strict();
export type LinkableRepository = z.infer<typeof linkableRepositorySchema>;

/**
 * Repository Link с состоянием доступа на GitHub сейчас: `revoked` — установку удалили или
 * репозиторий из неё убрали, проверка недоступна; `unknown` — GitHub не ответил.
 */
export const repositoryLinkViewSchema = z
  .object({
    installationId: z.number().int().positive(),
    repository: repositorySchema,
    connectedAt: z.iso.datetime(),
    access: z.enum(["available", "revoked", "unknown"]),
  })
  .strict();
export type RepositoryLinkView = z.infer<typeof repositoryLinkViewSchema>;

export function repositoryHtmlUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}
