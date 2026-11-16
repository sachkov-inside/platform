import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { refreshAnnouncedQueries } from "@/shared/api/announced-query-refresh";
import { factAnnouncement } from "@/shared/api/fact-announcement";

/**
 * Число сдач без комментария автора для счётчика «Сдач» в каркасе (#1717). «Без комментария» —
 * у сдачи нет сохранённого отзыва автора: ни комментария, ни прежней отметки «посмотрел автор»;
 * так же сдачу видит ученик («отзыва пока нет»). Право то же, что у списка сдач.
 */
export type AwaitingFeedbackCountState =
  | { readonly kind: "ready"; readonly count: number }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const awaitingFeedbackCountStateSchema: z.ZodType<AwaitingFeedbackCountState> =
  z.union([
    z
      .object({
        count: z.number().int().nonnegative(),
        kind: z.literal("ready"),
      })
      .strict(),
    z.object({ kind: z.literal("signed_out") }).strict(),
    z.object({ kind: z.literal("forbidden") }).strict(),
    z
      .object({ kind: z.literal("unavailable"), reference: z.string() })
      .strict(),
  ]);

export const awaitingFeedbackCountQueryKey = [
  "authoring",
  "submissions",
  "awaiting-feedback-count",
] as const;

/** Сохранённый или снятый отзыв автора объявляется всем открытым поверхностям браузера. */
export const authorFeedbackWritten = factAnnouncement(
  "inside.author-feedback.written",
);

/** Перечитать после отзыва, отменив старый ответ; повтор той же записи делит чтение (#2268). */
export function resetAwaitingFeedbackCount(
  client: QueryClient,
  announcementId: string,
): Promise<void> {
  return refreshAnnouncedQueries(
    client,
    awaitingFeedbackCountQueryKey,
    announcementId,
  );
}
