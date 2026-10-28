import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { NotificationsPrismaClient } from "../../../../infrastructure/prisma/index.js";

/**
 * How far back a failed Telegram delivery still needs the owner's attention. An unknown result has
 * no such window: it stays a problem until resolved or skipped.
 */
export const TELEGRAM_DELIVERY_ATTENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The largest problem set one read answers; a larger set is refused, never cut. */
export const TELEGRAM_DELIVERY_PROBLEM_ACCOUNTS_LIMIT = 50_000;

export type TelegramDeliveryProblemsResult =
  | { readonly ok: true; readonly accountIds: readonly string[] }
  | { readonly ok: false };

/**
 * Accounts with a Telegram delivery not skipped by the operator's recovery whose result is unknown,
 * whenever it changed, or that failed within the last {@link TELEGRAM_DELIVERY_ATTENTION_DAYS} days
 * before `now`, ascending (#1719). An unknown result never ages into «no problem».
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
            recoverySkipped: false,
            OR: [
              { state: "unknown" },
              { state: "failed", updatedAt: { gte: since } },
            ],
          },
        },
      },
      orderBy: { accountId: "asc" },
      take: TELEGRAM_DELIVERY_PROBLEM_ACCOUNTS_LIMIT + 1,
    });
    if (rows.length > TELEGRAM_DELIVERY_PROBLEM_ACCOUNTS_LIMIT)
      return dependencyFailure(
        { module: "notifications", operation: "listTelegramProblemAccounts" },
        new RangeError("Telegram delivery problem set exceeds its bound"),
        { ok: false } as const,
      );
    return { ok: true, accountIds: rows.map((row) => row.accountId) };
  } catch (error) {
    return dependencyFailure(
      { module: "notifications", operation: "listTelegramProblemAccounts" },
      error,
      { ok: false } as const,
    );
  }
}
