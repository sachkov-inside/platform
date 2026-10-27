import { z } from "zod";
import {
  calendarDay,
  dayValueRowsSchema,
  type DailyWindow,
  type DayValue,
} from "../../../../infrastructure/contracts/daily-window.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

/** The most recent payments one read returns: a feed, not a list. */
export const RECENT_PAYMENTS_LIMIT = 20;

const productIdSchema = z.uuid().toLowerCase();

type Failure = {
  readonly ok: false;
  readonly error: { readonly code: "dependency_unavailable" };
};
const unavailable: Failure = {
  ok: false,
  error: { code: "dependency_unavailable" },
};

export type DailySalesResult =
  | {
      readonly ok: true;
      /** Confirmed purchases per day of their confirmation. */
      readonly sales: readonly DayValue[];
      /**
       * Kopecks per day: confirmed purchase amounts by confirmation day minus confirmed refunds by
       * the day of their `updated_at`, so a day may be negative. `accept-bank-refund.ts`, the only
       * writer of refunds, sets `updated_at` together with `state: "confirmed"`; the trigger
       * `protect_refund_amount` (migration 0055) forbids leaving a terminal state, and no code
       * rewrites a confirmed refund, so that column stays the confirmation instant.
       */
      readonly revenue: readonly DayValue[];
    }
  | Failure;

export type SalesAttentionResult =
  | {
      readonly ok: true;
      /** Purchases whose bank result is `unknown` or only `authorized`, whenever they started. */
      readonly undetermined: number;
      /** Confirmed purchases with an unapplied fulfillment row, preparing or under review. */
      readonly fulfillmentIncomplete: number;
    }
  | Failure;

export interface RecentPayment {
  readonly purchaseRef: string;
  readonly accountId: string;
  readonly amountKopecks: number;
  readonly confirmedAt: Date;
  /** The Product of the paid snapshot; `null` for a purchase without one. */
  readonly productId: string | null;
}

export type RecentPaymentsResult =
  { readonly ok: true; readonly items: readonly RecentPayment[] } | Failure;

const recentRowsSchema = z.array(
  z.object({
    purchaseRef: z.uuid(),
    accountId: z.uuid(),
    amountKopecks: z.coerce.number().int().nonnegative(),
    confirmedAt: z.date(),
    productId: z.uuid().nullable(),
  }),
);
const attentionRowsSchema = z.array(
  z.object({
    undetermined: z.coerce.number().int(),
    fulfillmentIncomplete: z.coerce.number().int(),
  }),
);

/** `snapshot.product.id` of a purchase row aliased `purchase`, the path `payments.list` filters. */
function productFilter(productId: string | undefined): Prisma.Sql {
  return productId === undefined
    ? Prisma.empty
    : Prisma.sql`and purchase.snapshot -> 'product' ->> 'id' = ${productId}`;
}

/**
 * Daily sales and net revenue of the admin Overview (#1719). An internal read without an actor:
 * the composing read checks `billing:manage` first. `productId` narrows to the Product of the paid
 * snapshot, the path `payments.list` filters.
 */
export async function readDailySales(
  prisma: BillingPrismaClient,
  window: DailyWindow,
  productId?: string,
): Promise<DailySalesResult> {
  const product =
    productId === undefined ? undefined : productIdSchema.parse(productId);
  const day = (column: Prisma.Sql) => calendarDay(column, window);
  try {
    const [sales, revenue] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`
        select ${day(Prisma.sql`purchase.confirmed_at`)} as date, count(*)::int as value
        from billing.purchases as purchase
        where purchase.state = 'confirmed'
          and purchase.confirmed_at >= ${window.from}
          and purchase.confirmed_at < ${window.to}
          ${productFilter(product)}
        group by 1 order by 1
      `),
      prisma.$queryRaw(Prisma.sql`
        select movement.date, sum(movement.amount)::int8 as value
        from (
          select ${day(Prisma.sql`purchase.confirmed_at`)} as date,
            purchase.amount_kopecks as amount
          from billing.purchases as purchase
          where purchase.state = 'confirmed'
            and purchase.confirmed_at >= ${window.from}
            and purchase.confirmed_at < ${window.to}
            ${productFilter(product)}
          union all
          select ${day(Prisma.sql`refund.updated_at`)} as date,
            -refund.amount_kopecks as amount
          from billing.refunds as refund
          join billing.purchases as purchase on purchase.id = refund.purchase_ref
          where refund.state = 'confirmed'
            and refund.updated_at >= ${window.from}
            and refund.updated_at < ${window.to}
            ${productFilter(product)}
        ) as movement
        group by movement.date order by movement.date
      `),
    ]);
    return {
      ok: true,
      sales: dayValueRowsSchema.parse(sales),
      revenue: dayValueRowsSchema.parse(revenue),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "readDailySales" },
      error,
      unavailable,
    );
  }
}

/** The payments that need the owner now, whenever they started. */
export async function countAttention(
  prisma: BillingPrismaClient,
): Promise<SalesAttentionResult> {
  try {
    const [row] = attentionRowsSchema.parse(
      await prisma.$queryRaw(Prisma.sql`
        select
          (select count(*) from billing.purchases
            where state in ('unknown', 'authorized'))::int as "undetermined",
          (select count(*) from billing.purchases as purchase
            where purchase.state = 'confirmed'
              and exists (select 1 from billing.fulfillment_outbox as fulfillment
                where fulfillment.purchase_ref = purchase.id
                  and fulfillment.applied_at is null))::int as "fulfillmentIncomplete"
      `),
    );
    if (row === undefined) throw new Error("Attention counts are missing");
    return { ok: true, ...row };
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "countAttention" },
      error,
      unavailable,
    );
  }
}

/** At most `limit` confirmed purchases, latest confirmation first. */
export async function listRecentPayments(
  prisma: BillingPrismaClient,
  limit: number,
  productId?: string,
): Promise<RecentPaymentsResult> {
  const take = z.int().min(1).max(RECENT_PAYMENTS_LIMIT).parse(limit);
  const product =
    productId === undefined ? undefined : productIdSchema.parse(productId);
  try {
    const rows = recentRowsSchema.parse(
      await prisma.$queryRaw(Prisma.sql`
        select purchase.id::text as "purchaseRef",
          purchase.account_id::text as "accountId",
          purchase.amount_kopecks as "amountKopecks",
          purchase.confirmed_at as "confirmedAt",
          case when purchase.snapshot -> 'product' ->> 'id'
              ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then purchase.snapshot -> 'product' ->> 'id' end as "productId"
        from billing.purchases as purchase
        where purchase.state = 'confirmed' and purchase.confirmed_at is not null
          ${productFilter(product)}
        order by purchase.confirmed_at desc, purchase.id desc
        limit ${take}
      `),
    );
    return { ok: true, items: rows };
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "listRecentPayments" },
      error,
      unavailable,
    );
  }
}
