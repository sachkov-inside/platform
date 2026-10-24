import { activityRetentionPass } from "../../infrastructure/activity-retention.js";
import type { ReadingActivityRetention } from "../../modules/reading-activity/index.js";
import type { BookmarkActivityRetention } from "../../modules/bookmarks/index.js";
import type {
  BillingPayments,
  BillingSubscriptions,
  BillingOperations,
  BillingNotices,
} from "../../modules/billing/index.js";

/** Обработчики очередей: простой — отчёт, неуспешный результат — сбой задания. */
export async function runRenewalJob(
  payments: Pick<BillingPayments, "renew">,
  subscriptions: Pick<BillingSubscriptions, "reconcileMethodFlows">,
  limit = 20,
) {
  const renewed = await payments.renew(limit);
  if (!renewed.ok) throw new Error(renewed.error.code);
  const bindings = await subscriptions.reconcileMethodFlows(limit);
  if (!bindings.ok) throw new Error(bindings.error.code);
  if (renewed.value.failed > 0 || bindings.value.failed > 0)
    throw new Error("provider_unavailable");
  return { ...renewed.value, bindings: bindings.value };
}

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

export async function runNoticeJob(
  notices: Pick<BillingNotices, "scheduleReminders">,
  limit = 20,
) {
  const result = await notices.scheduleReminders(limit);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
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
