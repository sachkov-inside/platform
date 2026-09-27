import { z } from "zod";

export const learningPracticesSchema = z
  .object({
    practices: z.array(
      z
        .object({
          practiceId: z.string().min(1).max(200),
          title: z.string().min(1).max(200),
          contextVersion: z.hash("sha256"),
          reviewProtocolVersion: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type LearningPractice = z.infer<
  typeof learningPracticesSchema
>["practices"][number];
export type LearningPracticesView =
  | {
      readonly kind: "available";
      readonly practices: readonly LearningPractice[];
    }
  | { readonly kind: "unavailable" };

export function practiceReviewPrompt(
  practice: LearningPractice,
  client: "Codex" | "Claude Code",
): string {
  return [
    "Проверь мою работу по заданию с указанным ниже идентификатором.",
    `Этот запрос предназначен отдельной сессии ${client} в настроенном режиме проверки: чтение проекта, без изменения файлов и запуска проекта/тестов, с подключённым только учебным MCP. Если MCP или режим проверки не настроены, не оценивай работу: назови недостающий шаг и направь меня в раздел «Настройка проверки» на странице этого урока, в инструкцию для ${client}. После подключения вернись к этому же запросу.`,
    "Начни с learning_practice_read:",
    JSON.stringify(
      {
        practiceId: practice.practiceId,
        expectedContextVersion: practice.contextVersion,
      },
      null,
      2,
    ),
    "Получи все части контекста с той же версией и контрольной суммой. При несовпадении версии не подставляй новую молча.",
    "Следуй общему протоколу проверки из MCP. Найди мои результаты в выбранном локальном проекте; при неоднозначности уточни область одним вопросом. Ветка не определяет задание.",
    "Дай полный отчёт по всем критериям со свидетельствами: подтверждено / нарушение / не проверено. Затем предложи необязательный разбор по одному вопросу. Исправления я сделаю отдельно; при повторной проверке перечитай текущие результаты.",
  ].join("\n\n");
}
