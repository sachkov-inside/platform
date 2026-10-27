import { activityRetentionPass } from "../../infrastructure/activity-retention.js";
import type { ReadingActivityRetention } from "../../modules/reading-activity/index.js";
import type { BookmarkActivityRetention } from "../../modules/bookmarks/index.js";
import type {
  BillingOperations,
  BillingPayments,
} from "../../modules/billing/index.js";

export async function runRecoveryJob(
  payments: Pick<BillingPayments, "recover">,
  operations: Pick<BillingOperations, "reconcileRefunds">,
  limit = 20,
) {
  const result = await payments.recover(limit);
  if (!result.ok) throw new Error(result.error.code);
  // Сверка читает состояние платежа; банковский Cancel запрещён политикой #1420.
  const refunds = await operations.reconcileRefunds(limit);
  if (result.value.failed > 0 || refunds.failed > 0)
    throw new Error("provider_unavailable");
  return { ...result.value, refunds };
}
class ActivityRetentionFailure extends Error {
  constructor(
    readonly activityRetention: ReturnType<typeof activityRetentionPass>,
  ) {
    super("activity_retention_failed");
  }
}
/** Each owner commits independently; the failed receipt retains validated partial outcomes. */
export async function runActivityRetentionJob(
  reading: Pick<ReadingActivityRetention, "clean">,
  bookmarks: Pick<BookmarkActivityRetention, "clean">,
) {
  const settle = async (owner: Pick<ReadingActivityRetention, "clean">) => {
    try {
      return await owner.clean();
    } catch {
      return {
        ok: false as const,
        status: "unknown" as const,
        error: { code: "source_unavailable" as const },
      };
    }
  };
  const report = activityRetentionPass(
    await settle(reading),
    await settle(bookmarks),
  );
  if (report.outcome === "failed") throw new ActivityRetentionFailure(report);
  return { activityRetention: report };
}
