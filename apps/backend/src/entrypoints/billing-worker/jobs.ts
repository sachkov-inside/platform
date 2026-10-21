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

/** Each owner commits independently; a failure cannot undo a previously committed copy batch. */
export async function runActivityRetentionJob(
  reading: Pick<ReadingActivityRetention, "clean">,
  bookmarks: Pick<BookmarkActivityRetention, "clean">,
) {
  const sources = [];
  for (const [source, owner] of [
    ["learning_started", reading],
    ["bookmarks", bookmarks],
  ] as const) {
    try {
      sources.push({ source, result: await owner.clean() });
    } catch {
      sources.push({
        source,
        result: {
          ok: false as const,
          status: "unknown" as const,
          error: { code: "source_unavailable" as const },
        },
      });
    }
  }
  if (sources.some((source) => !source.result.ok))
    throw new Error("activity_retention_failed");
  return { sources };
}
