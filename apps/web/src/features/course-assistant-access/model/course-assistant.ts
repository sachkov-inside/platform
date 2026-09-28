import { z } from "zod";

const repositorySchema = z.object({
  id: z.number().int().positive(),
  fullName: z.string().min(1),
  htmlUrl: z.url(),
});

export const linkableRepositorySchema = z.object({
  installationId: z.number().int().positive(),
  repository: repositorySchema,
});

export const repositoryLinkSchema = z.object({
  installationId: z.number().int().positive(),
  repository: repositorySchema,
  connectedAt: z.iso.datetime(),
  access: z.enum(["available", "revoked", "unknown"]),
});

export const courseAssistantParticipantSchema = z.object({
  dataNotice: z.object({
    version: z.string().min(1),
    acknowledgedAt: z.iso.datetime().nullable(),
  }),
  repositoryLink: repositoryLinkSchema.nullable(),
});

export const courseAssistantFailureCodeSchema = z.enum([
  "unauthorized",
  "course_assistant_unavailable",
  "data_notice_required",
  "stale_data_notice",
  "invalid_connection",
  "installation_not_owned",
  "write_access_requested",
  "repository_not_available",
  "invalid_request",
  "unavailable",
]);

const failureSchema = z.object({
  ok: z.literal(false),
  code: courseAssistantFailureCodeSchema,
});

export const courseAssistantWriteResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  failureSchema,
]);
export const repositoryConnectionResultSchema = z.union([
  z.object({ ok: z.literal(true), installUrl: z.url() }),
  failureSchema,
]);
export const linkableRepositoriesResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    repositories: z.array(linkableRepositorySchema),
  }),
  failureSchema,
]);

/** Исход возврата из GitHub, который страница помощника показывает после перенаправления. */
export const repositoryConnectionOutcomeSchema = z.enum([
  "connected",
  "choose_repository",
  "request_pending",
  "session_expired",
  "invalid_connection",
  "installation_not_owned",
  "write_access_requested",
  "unavailable",
]);

export type CourseAssistantParticipant = z.infer<
  typeof courseAssistantParticipantSchema
>;
export type RepositoryLink = z.infer<typeof repositoryLinkSchema>;
export type LinkableRepository = z.infer<typeof linkableRepositorySchema>;
export type CourseAssistantFailureCode = z.infer<
  typeof courseAssistantFailureCodeSchema
>;
export type CourseAssistantWriteResult = z.infer<
  typeof courseAssistantWriteResultSchema
>;
export type RepositoryConnectionResult = z.infer<
  typeof repositoryConnectionResultSchema
>;
export type LinkableRepositoriesResult = z.infer<
  typeof linkableRepositoriesResultSchema
>;
export type RepositoryConnectionOutcome = z.infer<
  typeof repositoryConnectionOutcomeSchema
>;

export function courseAssistantErrorMessage(
  code: CourseAssistantFailureCode,
): string {
  switch (code) {
    case "unauthorized":
      return "Сессия закончилась. Войдите снова и повторите действие.";
    case "course_assistant_unavailable":
      return "Помощник курса сейчас недоступен для этого аккаунта.";
    case "data_notice_required":
    case "stale_data_notice":
      return "Сначала прочитайте предупреждение о данных: его текст обновился.";
    case "invalid_connection":
      return "Подключение устарело. Начните его заново.";
    case "installation_not_owned":
      return "Эта установка GitHub App принадлежит другому пользователю GitHub.";
    case "write_access_requested":
      return "Установка просит больше прав, чем чтение. Такую установку курс не принимает.";
    case "repository_not_available":
      return "Этот репозиторий больше не открыт курсу. Выберите другой или подключите заново.";
    case "invalid_request":
    case "unavailable":
      return "Не получилось выполнить действие. Попробуйте ещё раз чуть позже.";
  }
}

export function repositoryConnectionOutcomeMessage(
  outcome: RepositoryConnectionOutcome,
): { readonly tone: "success" | "info" | "error"; readonly text: string } {
  switch (outcome) {
    case "connected":
      return { tone: "success", text: "Репозиторий подключён." };
    case "choose_repository":
      return {
        tone: "info",
        text: "GitHub App установлена. Выберите репозиторий учебного проекта.",
      };
    case "request_pending":
      return {
        tone: "info",
        text: "Установка ждёт одобрения владельца организации на GitHub.",
      };
    case "session_expired":
      return {
        tone: "error",
        text: "Сессия закончилась до возврата из GitHub. Войдите и подключите репозиторий заново.",
      };
    case "invalid_connection":
      return {
        tone: "error",
        text: courseAssistantErrorMessage("invalid_connection"),
      };
    case "installation_not_owned":
      return {
        tone: "error",
        text: courseAssistantErrorMessage("installation_not_owned"),
      };
    case "write_access_requested":
      return {
        tone: "error",
        text: courseAssistantErrorMessage("write_access_requested"),
      };
    case "unavailable":
      return {
        tone: "error",
        text: "GitHub не ответил. Подключите репозиторий ещё раз чуть позже.",
      };
  }
}
