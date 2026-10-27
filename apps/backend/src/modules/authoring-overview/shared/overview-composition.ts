import { z } from "zod";

import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../infrastructure/observability/index.js";
import type {
  AccessGrants,
  ProductAccessOrigin,
} from "../../account-rights/index.js";
import type { AccountDirectory, Accounts } from "../../accounts/index.js";
import type { BillingSalesOverview } from "../../billing/index.js";
import type { Notifications } from "../../notifications/index.js";
import type { PeopleDirectory } from "../../people-directory/index.js";
import type { SubmissionReview } from "../../product-tasks/index.js";
import type {
  ProductDiscovery,
  ProductOutlines,
} from "../../products/index.js";
import type { ReadingActivity } from "../../reading-activity/index.js";
import type {
  ProductWaitlists,
  SalesFunnel,
} from "../../sales-funnel/index.js";
import type {
  CommunityEntitlements,
  TelegramAccountLinks,
} from "../../telegram-membership/index.js";
import {
  OVERVIEW_DEFAULT_PERIOD,
  OVERVIEW_EVENTS_LIMIT,
  overviewPeriodQuerySchema,
  type OverviewEvent,
  type OverviewOrigin,
  type OverviewOriginCounts,
  type OverviewPeriodDays,
  type OverviewSourceState,
} from "./overview-contract.js";

/** The owners whose facts the Overview composes; it owns no table of its own. */
export interface OverviewDependencies {
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly directory: Pick<AccountDirectory, "countNewPeople">;
  readonly links: Pick<TelegramAccountLinks, "listLinkedAccountIds">;
  readonly sales: Pick<
    BillingSalesOverview,
    "readDailySales" | "countAttention" | "listRecentPayments"
  >;
  readonly access: Pick<
    AccessGrants,
    | "readNewAccessByDay"
    | "listRecentAccessActions"
    | "countActiveHolders"
    | "listAccessAccounts"
  >;
  readonly products: Pick<ProductDiscovery, "metadata">;
  readonly outlines: Pick<ProductOutlines, "list">;
  readonly funnel: Pick<SalesFunnel, "readReport">;
  readonly waitlists: Pick<ProductWaitlists, "countJoinsByDay" | "demand">;
  readonly learning: Pick<ReadingActivity, "summarizeProductLearning">;
  readonly submissions: Pick<
    SubmissionReview,
    "countAwaitingFeedback" | "list"
  >;
  readonly community: Pick<CommunityEntitlements, "listProblemAccounts">;
  readonly deliveries: Pick<Notifications, "listTelegramProblemAccounts">;
  readonly people: Pick<PeopleDirectory, "readIdentities">;
  readonly clock: () => Date;
}

export type OperationName = "readAuthoringOverview" | "readProductOverview";

const periodQuerySchema = z.strictObject({ period: overviewPeriodQuerySchema });

/** `period` of the query string; `undefined` is a malformed request. */
export function parsePeriod(input: unknown): OverviewPeriodDays | undefined {
  const parsed = periodQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return undefined;
  return parsed.data.period ?? OVERVIEW_DEFAULT_PERIOD;
}

/** The Overview's four groups of the first-acquisition origin. */
export function overviewOrigin(origin: ProductAccessOrigin): OverviewOrigin {
  switch (origin) {
    case "paid":
      return "purchase";
    case "course_activation":
      return "course_activation";
    case "manual":
      return "manual";
    case "legacy":
    case "unknown":
      return "other";
  }
}

export function emptyOriginCounts(): OverviewOriginCounts {
  return { purchase: 0, course_activation: 0, manual: 0, other: 0 };
}

/** An event before its person and Product names are known. */
export type PendingEvent =
  | {
      readonly kind: "payment_confirmed";
      readonly source: "payments";
      readonly occurredAt: Date;
      readonly accountId: string;
      readonly purchaseRef: string;
      readonly amountKopecks: number;
      readonly productId: string | null;
    }
  | {
      readonly kind: "access_issued" | "access_revoked" | "access_restored";
      readonly source: "access";
      readonly occurredAt: Date;
      readonly accountId: string;
      readonly productId: string;
      readonly origin: OverviewOrigin;
    }
  | {
      readonly kind: "submission";
      readonly source: "submissions";
      readonly occurredAt: Date;
      readonly accountId: string;
      readonly submissionId: string;
      readonly commented: boolean;
      readonly product: { readonly id: string; readonly name: string } | null;
      readonly taskTitle: string | null;
    };

export type EventSource = PendingEvent["source"];

/** One source's newest events, or why it has none. */
export type SourceRead =
  | { readonly state: "ready"; readonly events: readonly PendingEvent[] }
  | { readonly state: "forbidden" | "unavailable" };

/** The latest confirmed payments as events; `productId` narrows them to one Product. */
export async function readPaymentEvents(
  dependencies: Pick<OverviewDependencies, "sales">,
  productId?: string,
): Promise<SourceRead> {
  const recent = await dependencies.sales.listRecentPayments(
    OVERVIEW_EVENTS_LIMIT,
    productId,
  );
  if (!recent.ok) return { state: "unavailable" };
  return {
    state: "ready",
    events: recent.items.map((payment) => ({
      kind: "payment_confirmed",
      source: "payments",
      occurredAt: payment.confirmedAt,
      accountId: payment.accountId,
      purchaseRef: payment.purchaseRef,
      amountKopecks: payment.amountKopecks,
      productId: payment.productId,
    })),
  };
}

/** The latest issues, revocations and restorations as events. */
export async function readAccessEvents(
  dependencies: Pick<OverviewDependencies, "access">,
  actorId: string,
  productId?: string,
): Promise<SourceRead> {
  const recent = await dependencies.access.listRecentAccessActions(
    actorId,
    OVERVIEW_EVENTS_LIMIT,
    productId,
  );
  if (!recent.ok)
    return {
      state: recent.error.code === "forbidden" ? "forbidden" : "unavailable",
    };
  return {
    state: "ready",
    events: recent.items.map((action) => ({
      kind:
        action.kind === "issue"
          ? "access_issued"
          : action.kind === "revoke"
            ? "access_revoked"
            : "access_restored",
      source: "access",
      occurredAt: action.recordedAt,
      accountId: action.accountId,
      productId: action.productId,
      origin: overviewOrigin(action.origin),
    })),
  };
}

const textOrder = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

/** Newest first; a shared instant falls back to kind and Account, so the cut is stable. */
function eventOrder(left: PendingEvent, right: PendingEvent): number {
  const byTime = right.occurredAt.getTime() - left.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  const byKind = textOrder(left.kind, right.kind);
  return byKind !== 0 ? byKind : textOrder(left.accountId, right.accountId);
}

/**
 * The newest events of the ready sources, merged and cut to the feed's size, with their Product
 * names from the catalogue and, only when `withNames`, the Telegram name and @username of each
 * person. A source whose Products the catalogue cannot name turns unavailable; names are optional
 * facts, so a failed identities read leaves them null.
 */
export async function composeEvents(
  dependencies: Pick<OverviewDependencies, "products" | "people">,
  operation: OperationName,
  actorId: string,
  reads: Readonly<Partial<Record<EventSource, SourceRead>>>,
  withNames: boolean,
): Promise<{
  readonly items: readonly OverviewEvent[];
  readonly states: Readonly<Partial<Record<EventSource, OverviewSourceState>>>;
}> {
  const states: Partial<Record<EventSource, OverviewSourceState>> = {};
  for (const source of ["payments", "access", "submissions"] as const) {
    const read = reads[source];
    if (read !== undefined) states[source] = read.state;
  }
  const named = async (events: readonly PendingEvent[]) => {
    const productIds = [
      ...new Set(
        events.flatMap((event) =>
          event.source === "submissions" || event.productId === null
            ? []
            : [event.productId],
        ),
      ),
    ];
    if (productIds.length === 0) return new Map<string, string>();
    try {
      const products = await dependencies.products.metadata({
        ids: productIds,
      });
      return new Map(products.map((product) => [product.id, product.name]));
    } catch (error) {
      return dependencyFailure(
        { module: "authoring-overview", operation },
        error,
        undefined,
      );
    }
  };
  let pending = Object.values(reads)
    .flatMap((read) => (read.state === "ready" ? read.events : []))
    .sort(eventOrder)
    .slice(0, OVERVIEW_EVENTS_LIMIT);
  const names = await named(pending);
  if (names === undefined) {
    for (const source of ["payments", "access"] as const)
      if (states[source] === "ready") states[source] = "unavailable";
    pending = Object.values(reads)
      .flatMap((read) =>
        read.state === "ready"
          ? read.events.filter((event) => event.source === "submissions")
          : [],
      )
      .sort(eventOrder)
      .slice(0, OVERVIEW_EVENTS_LIMIT);
  } else if (
    pending.some(
      (event) => event.source === "access" && !names.has(event.productId),
    )
  ) {
    // Products are archived, never deleted: an access event naming no Product is a broken fact.
    reportDependencyFailure(
      { module: "authoring-overview", operation },
      new RangeError("Product Access names a Product the catalogue lacks"),
    );
    states.access = "unavailable";
    pending = pending.filter((event) => event.source !== "access");
  }
  const people = new Map<
    string,
    { readonly name: string | null; readonly username: string | null }
  >();
  const accountIds = [...new Set(pending.map((event) => event.accountId))];
  if (withNames && accountIds.length > 0) {
    const identities = await dependencies.people.readIdentities(
      actorId,
      accountIds,
    );
    if (identities.ok)
      for (const identity of identities.value)
        people.set(identity.accountId.toLowerCase(), {
          name: identity.displayName,
          username: identity.username,
        });
  }
  const items = pending.map((event): OverviewEvent => {
    const identity = people.get(event.accountId.toLowerCase());
    const person = {
      accountId: event.accountId,
      name: identity?.name ?? null,
      username: identity?.username ?? null,
    };
    const occurredAt = event.occurredAt.toISOString();
    switch (event.kind) {
      case "payment_confirmed": {
        const name =
          event.productId === null ? undefined : names?.get(event.productId);
        return {
          kind: event.kind,
          occurredAt,
          person,
          purchaseRef: event.purchaseRef,
          amountKopecks: event.amountKopecks,
          product:
            event.productId === null || name === undefined
              ? null
              : { id: event.productId, name },
        };
      }
      case "access_issued":
        return {
          kind: event.kind,
          occurredAt,
          person,
          origin: event.origin,
          product: {
            id: event.productId,
            name: names?.get(event.productId) ?? "",
          },
        };
      case "access_revoked":
      case "access_restored":
        return {
          kind: event.kind,
          occurredAt,
          person,
          product: {
            id: event.productId,
            name: names?.get(event.productId) ?? "",
          },
        };
      case "submission":
        return {
          kind: event.kind,
          occurredAt,
          person,
          submissionId: event.submissionId,
          commented: event.commented,
          product: event.product,
          taskTitle: event.taskTitle,
        };
    }
  });
  return { items, states };
}
