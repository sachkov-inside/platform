import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { NotificationsPrismaClient } from "../../../../infrastructure/prisma/index.js";

/** How far back a failed or unknown Telegram delivery still needs the owner's attention. */
export const TELEGRAM_DELIVERY_ATTENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The largest problem set one read answers; a larger set is refused, never cut. */
export const TELEGRAM_DELIVERY_PROBLEM_ACCOUNTS_LIMIT = 50_000;

export type TelegramDeliveryProblemsResult =
  | { readonly ok: true; readonly accountIds: readonly string[] }
  | { readonly ok: false };

/**
 * Accounts with a Telegram delivery that failed or whose result is unknown, changed within the
 * last {@link TELEGRAM_DELIVERY_ATTENTION_DAYS} days before `now` and not skipped by the operator's
 * recovery, ascending (#1719). An unknown result is a problem, never «delivered».
 */
export async function listTelegramDeliveryProblems(
  prisma: NotificationsPrismaClient,
  now: Date,
): Promise<TelegramDeliveryProblemsResult> {
  const since = new Date(
    now.getTime() - TELEGRAM_DELIVERY_ATTENTION_DAYS * DAY_MS,
  );
  try {
    // One GROUP BY over notifications with a semi-join on their deliveries: a distinct Account set.
    const rows = await prisma.notification.groupBy({
      by: ["accountId"],
      where: {
        deliveries: {
          some: {
            channel: "telegram",
            state: { in: ["failed", "unknown"] },
            recoverySkipped: false,
            updatedAt: { gte: since },
          },
        },
      },
      orderBy: { accountId: "asc" },
      take: TELEGRAM_DELIVERY_PROBLEM_ACCOUNTS_LIMIT + 1,
    });
    if (rows.length > TELEGRAM_DELIVERY_PROBLEM_ACCOUNTS_LIMIT)
      return dependencyFailure(
        { module: "notifications", operation: "listTelegramDeliveryProblems" },
        new RangeError("Telegram delivery problem set exceeds its bound"),
        { ok: false } as const,
      );
    return { ok: true, accountIds: rows.map((row) => row.accountId) };
  } catch (error) {
    return dependencyFailure(
      { module: "notifications", operation: "listTelegramDeliveryProblems" },
      error,
      { ok: false } as const,
    );
  }
}
