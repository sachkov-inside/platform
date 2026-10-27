import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  overviewPeriod,
  seriesOf,
  spannedWindow,
} from "../../domain/overview-period.js";
import type {
  OverviewPeriod,
  ProductOverview,
} from "../../shared/overview-contract.js";
import {
  composeEvents,
  emptyOriginCounts,
  overviewOrigin,
  parsePeriod,
  readAccessEvents,
  readPaymentEvents,
  type OverviewDependencies,
} from "../../shared/overview-composition.js";

export type ReadProductOverviewResult =
  | { readonly ok: true; readonly value: ProductOverview }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "invalid_request"
          | "forbidden"
          | "product_not_found"
          | "dependency_unavailable";
      };
    };

const failure = (
  code:
    | "invalid_request"
    | "forbidden"
    | "product_not_found"
    | "dependency_unavailable",
): ReadProductOverviewResult => ({ ok: false, error: { code } });

const unavailable = { state: "unavailable" } as const;
const productIdSchema = z.uuid().toLowerCase();

/**
 * One Product's Overview (#1719) under `billing:manage`, checked before the request is read: its
 * active holders by first-acquisition origin, revenue and sales of its paid snapshots with the
 * previous period, the accepting waitlist intake with its eligible active memberships (the
 * funnel report's rule), learning of its active holders and its latest payment and access events.
 * A block whose owner failed is `unavailable`; the other blocks still answer.
 */
export async function readProductOverview(
  dependencies: OverviewDependencies,
  actorId: string,
  productId: unknown,
  input: unknown,
): Promise<ReadProductOverviewResult> {
  const decision = await dependencies.accounts.checkPermission({
    accountId: actorId,
    permission: "billing:manage",
  });
  if (!decision.ok) return failure("dependency_unavailable");
  if (!decision.allowed) return failure("forbidden");
  const product = productIdSchema.safeParse(productId);
  const days = parsePeriod(input);
  if (!product.success || days === undefined) return failure("invalid_request");
  const id = product.data;
  try {
    const found = await dependencies.products.metadata({ ids: [id] });
    if (found.length === 0) return failure("product_not_found");
  } catch (error) {
    return dependencyFailure(
      { module: "authoring-overview", operation: "readProductOverview" },
      error,
      failure("dependency_unavailable"),
    );
  }
  const period = overviewPeriod(dependencies.clock(), days);

  const [holders, daily, waitlist, learning, payments, access] =
    await Promise.all([
      readHolders(dependencies, actorId, id),
      dependencies.sales.readDailySales(spannedWindow(period), id),
      readWaitlist(dependencies, id, period),
      readLearning(dependencies, actorId, id),
      readPaymentEvents(dependencies, id),
      readAccessEvents(dependencies, actorId, id),
    ]);
  const events = await composeEvents(
    dependencies,
    "readProductOverview",
    actorId,
    { payments, access },
    true,
  );
  const metric = (kind: "sales" | "revenue"): ProductOverview["sales"] =>
    daily.ok
      ? {
          state: "ready",
          current: seriesOf(period.current, daily[kind]),
          previous: seriesOf(period.previous, daily[kind]),
        }
      : unavailable;
  return {
    ok: true,
    value: {
      period,
      holders,
      revenue: metric("revenue"),
      sales: metric("sales"),
      waitlist,
      learning,
      // Both sources ran under the right already checked, so neither is forbidden here.
      events:
        events.states.payments === "ready" && events.states.access === "ready"
          ? { state: "ready", items: [...events.items] }
          : unavailable,
    },
  };
}

async function readHolders(
  dependencies: OverviewDependencies,
  actorId: string,
  productId: string,
): Promise<ProductOverview["holders"]> {
  const groups = await dependencies.access.countActiveHolders(
    actorId,
    productId,
  );
  if (!groups.ok) return unavailable;
  const byOrigin = emptyOriginCounts();
  for (const group of groups.groups)
    byOrigin[overviewOrigin(group.origin)] += group.value;
  return {
    state: "ready",
    active:
      byOrigin.purchase +
      byOrigin.course_activation +
      byOrigin.manual +
      byOrigin.other,
    byOrigin,
  };
}

async function readWaitlist(
  dependencies: OverviewDependencies,
  productId: string,
  period: OverviewPeriod,
): Promise<ProductOverview["waitlist"]> {
  const demand = await dependencies.waitlists.demand({
    productId,
    from: new Date(period.current.from),
    to: new Date(period.current.to),
  });
  if (!demand.ok) return unavailable;
  return {
    state: "ready",
    intake:
      demand.value === null
        ? null
        : { name: demand.value.name, active: demand.value.active },
  };
}

async function readLearning(
  dependencies: OverviewDependencies,
  actorId: string,
  productId: string,
): Promise<ProductOverview["learning"]> {
  const holders = await dependencies.access.listAccessAccounts(actorId, {
    productId,
    state: "active",
  });
  if (!holders.ok) return unavailable;
  const summary = await dependencies.learning.summarizeProductLearning({
    productId,
    accountIds: holders.accountIds,
  });
  if (!summary.ok) return unavailable;
  return {
    state: "ready",
    holders: summary.value.accounts,
    started: summary.value.started,
    averageProgress: summary.value.averageProgress,
  };
}
