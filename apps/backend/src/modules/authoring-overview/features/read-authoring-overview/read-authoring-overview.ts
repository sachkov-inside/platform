import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  overviewPeriod,
  seriesOf,
  spannedWindow,
} from "../../domain/overview-period.js";
import type {
  AuthoringOverview,
  OverviewAttentionItem,
  OverviewMetric,
  OverviewPeriod,
} from "../../shared/overview-contract.js";
import { OVERVIEW_EVENTS_LIMIT } from "../../shared/overview-contract.js";
import {
  composeEvents,
  emptyOriginCounts,
  overviewOrigin,
  parsePeriod,
  readAccessEvents,
  readPaymentEvents,
  type OverviewDependencies,
  type SourceRead,
} from "../../shared/overview-composition.js";
import type { ReadAuthoringOverviewResult } from "../../shared/overview-reads.js";

const failure = (
  code: "invalid_request" | "forbidden" | "dependency_unavailable",
): ReadAuthoringOverviewResult => ({ ok: false, error: { code } });

const unavailable = { state: "unavailable" } as const;
const forbidden = { state: "forbidden" } as const;

type Window = ReturnType<typeof spannedWindow>;
type Days = readonly { readonly date: string; readonly value: number }[];

function metric(
  period: OverviewPeriod,
  days: Days | undefined,
): OverviewMetric {
  return days === undefined
    ? unavailable
    : {
        state: "ready",
        current: seriesOf(period.current, days),
        previous: seriesOf(period.previous, days),
      };
}

/**
 * The admin Overview (#1719). `billing:manage` reads metrics, the funnel, the payment and Telegram
 * attention items, payment and access events, learning and person names; the submissions right
 * (`materials:manage`, as the submissions list) reads the submissions item and events. Either
 * right is enough; without both the read is refused, and checked before the request is read. A
 * block without its right is `forbidden`, a block whose owner failed `unavailable`; the other
 * blocks still answer. Every period bound and the attention deadlines come from one clock reading.
 */
export async function readAuthoringOverview(
  dependencies: OverviewDependencies,
  actorId: string,
  input: unknown,
): Promise<ReadAuthoringOverviewResult> {
  const [billing, materials] = await Promise.all([
    dependencies.accounts.checkPermission({
      accountId: actorId,
      permission: "billing:manage",
    }),
    dependencies.accounts.checkPermission({
      accountId: actorId,
      permission: "materials:manage",
    }),
  ]);
  if (!billing.ok || !materials.ok) return failure("dependency_unavailable");
  if (!billing.allowed && !materials.allowed) return failure("forbidden");
  const days = parsePeriod(input);
  if (days === undefined) return failure("invalid_request");
  const now = dependencies.clock();
  const period = overviewPeriod(now, days);
  const window = spannedWindow(period);
  const sales = billing.allowed;

  const [
    metrics,
    funnel,
    salesAttention,
    communityFailures,
    telegramDeliveryFailures,
    submissionsAwaitingFeedback,
    payments,
    access,
    submissions,
    learning,
  ] = await Promise.all([
    sales ? readMetrics(dependencies, actorId, period, window) : forbidden,
    sales ? readFunnel(dependencies, actorId, period) : forbidden,
    sales ? readSalesAttention(dependencies) : undefined,
    sales
      ? countSet(dependencies.community.listProblemAccounts(now))
      : forbidden,
    sales
      ? countSet(dependencies.deliveries.listTelegramProblemAccounts(now))
      : forbidden,
    materials.allowed
      ? countAwaitingFeedback(dependencies, actorId)
      : forbidden,
    sales ? readPaymentEvents(dependencies) : forbidden,
    sales ? readAccessEvents(dependencies, actorId) : forbidden,
    materials.allowed ? readSubmissionEvents(dependencies, actorId) : forbidden,
    sales ? readLearning(dependencies, actorId) : forbidden,
  ]);
  const events = await composeEvents(
    dependencies,
    "readAuthoringOverview",
    actorId,
    { payments, access, submissions },
    sales,
  );
  const overview: AuthoringOverview = {
    period,
    metrics,
    funnel,
    attention: {
      undeterminedPayments: salesAttention?.undetermined ?? forbidden,
      fulfillmentIncomplete: salesAttention?.fulfillmentIncomplete ?? forbidden,
      communityFailures,
      telegramDeliveryFailures,
      submissionsAwaitingFeedback,
    },
    events: {
      items: [...events.items],
      payments: events.states.payments ?? "forbidden",
      access: events.states.access ?? "forbidden",
      submissions: events.states.submissions ?? "forbidden",
    },
    learning,
  };
  return { ok: true, value: overview };
}

async function readMetrics(
  dependencies: OverviewDependencies,
  actorId: string,
  period: OverviewPeriod,
  window: Window,
): Promise<AuthoringOverview["metrics"]> {
  const [daily, newAccess, newAccounts, waitlistJoins] = await Promise.all([
    dependencies.sales.readDailySales(window),
    dependencies.access.readNewAccessByDay(actorId, window),
    readNewPeople(dependencies, window),
    dependencies.waitlists.countJoinsByDay(window),
  ]);
  const byOrigin = emptyOriginCounts();
  if (newAccess.ok)
    for (const day of newAccess.days)
      if (
        day.date >= period.current.firstDay &&
        day.date <= period.current.lastDay
      )
        byOrigin[overviewOrigin(day.origin)] += day.value;
  return {
    state: "ready",
    revenue: metric(period, daily.ok ? daily.revenue : undefined),
    sales: metric(period, daily.ok ? daily.sales : undefined),
    newAccess: newAccess.ok
      ? {
          state: "ready",
          current: seriesOf(period.current, newAccess.days),
          previous: seriesOf(period.previous, newAccess.days),
          byOrigin,
        }
      : unavailable,
    newAccounts: metric(period, newAccounts),
    waitlistJoins: metric(
      period,
      waitlistJoins.ok ? waitlistJoins.days : undefined,
    ),
  };
}

/** People registered per day: Telegram Membership names the linked Accounts, Accounts counts. */
async function readNewPeople(
  dependencies: OverviewDependencies,
  window: Window,
): Promise<Days | undefined> {
  const links = await dependencies.links.listLinkedAccountIds();
  if (!links.ok) return undefined;
  const people = await dependencies.directory.countNewPeople({
    ...window,
    linkedAccountIds: links.accountIds,
  });
  return people.ok ? people.days : undefined;
}

/**
 * The funnel report's totals for the current period and the Product the full report opens with:
 * its first Product. `consented` is historical and left out.
 */
async function readFunnel(
  dependencies: OverviewDependencies,
  actorId: string,
  period: OverviewPeriod,
): Promise<AuthoringOverview["funnel"]> {
  const outlines = await dependencies.outlines.list();
  if (!outlines.ok) return unavailable;
  const first = outlines.value[0];
  const report = await dependencies.funnel.readReport(actorId, {
    from: period.current.from,
    to: period.current.to,
    ...(first === undefined ? {} : { productId: first.id }),
  });
  if (!report.ok)
    return report.error.code === "forbidden" ? forbidden : unavailable;
  const product = report.value.products.find(
    (item) => item.id === report.value.selection?.productId,
  );
  const { total } = report.value;
  return {
    state: "ready",
    product:
      product === undefined ? null : { id: product.id, name: product.name },
    steps: {
      entered: total.entered,
      openedChapter: total.openedChapter,
      checkout: total.checkout,
      paid: total.paid,
    },
  };
}

async function readSalesAttention(dependencies: OverviewDependencies): Promise<{
  readonly undetermined: OverviewAttentionItem;
  readonly fulfillmentIncomplete: OverviewAttentionItem;
}> {
  const counts = await dependencies.sales.countAttention();
  if (!counts.ok)
    return { undetermined: unavailable, fulfillmentIncomplete: unavailable };
  return {
    undetermined: { state: "ready", count: counts.undetermined },
    fulfillmentIncomplete: {
      state: "ready",
      count: counts.fulfillmentIncomplete,
    },
  };
}

/** The size of an owner's complete Account set; a refused or failed set is unavailable. */
async function countSet(
  read: Promise<
    | { readonly ok: true; readonly accountIds: readonly string[] }
    | {
        readonly ok: false;
      }
  >,
): Promise<OverviewAttentionItem> {
  const set = await read;
  return set.ok
    ? { state: "ready", count: set.accountIds.length }
    : unavailable;
}

async function countAwaitingFeedback(
  dependencies: OverviewDependencies,
  actorId: string,
): Promise<OverviewAttentionItem> {
  const result = await dependencies.submissions.countAwaitingFeedback(actorId);
  if (result.ok) return { state: "ready", count: result.value.count };
  return result.error.code === "forbidden" ? forbidden : unavailable;
}

async function readSubmissionEvents(
  dependencies: OverviewDependencies,
  actorId: string,
): Promise<SourceRead> {
  const page = await dependencies.submissions.list(actorId, {
    limit: OVERVIEW_EVENTS_LIMIT,
  });
  if (!page.ok)
    return page.error.code === "forbidden" ? forbidden : unavailable;
  return {
    state: "ready",
    events: page.value.submissions.map((submission) => ({
      kind: "submission",
      source: "submissions",
      occurredAt: new Date(submission.submittedAt),
      accountId: submission.person.accountId,
      submissionId: submission.submissionId,
      commented: submission.authorFeedback !== null,
      product:
        submission.task.productName === null
          ? null
          : {
              id: submission.task.productId,
              name: submission.task.productName,
            },
      taskTitle: submission.task.title,
    })),
  };
}

/**
 * Every current Product with its active holders, how many of them started it and their mean
 * progress, most holders first. Each Product's holder set is complete or refused (Account Rights
 * bounds it at 50 000); one refused set makes the block unavailable rather than wrong.
 */
async function readLearning(
  dependencies: OverviewDependencies,
  actorId: string,
): Promise<AuthoringOverview["learning"]> {
  let products;
  try {
    products = (
      await dependencies.products.metadata({ includeActive: true })
    ).filter((product) => product.archivedAt === null);
  } catch (error) {
    return dependencyFailure(
      { module: "authoring-overview", operation: "readAuthoringOverview" },
      error,
      unavailable,
    );
  }
  const rows = [];
  // One Product at a time: two owner reads each, without holding the pool for the whole catalogue.
  for (const product of products) {
    const holders = await dependencies.access.listAccessAccounts(actorId, {
      productId: product.id,
      state: "active",
    });
    if (!holders.ok)
      return holders.error.code === "forbidden" ? forbidden : unavailable;
    const summary = await dependencies.learning.summarizeProductLearning({
      productId: product.id,
      accountIds: holders.accountIds,
    });
    if (!summary.ok) return unavailable;
    rows.push({
      productId: product.id,
      name: product.name,
      holders: summary.value.accounts,
      started: summary.value.started,
      averageProgress: summary.value.averageProgress,
    });
  }
  rows.sort((left, right) => {
    if (left.holders !== right.holders) return right.holders - left.holders;
    const byName = left.name.localeCompare(right.name, "ru");
    if (byName !== 0) return byName;
    return left.productId < right.productId ? -1 : 1;
  });
  return { state: "ready", products: rows };
}
