import { z } from "zod";
import { type DailyWindow } from "../../../../infrastructure/contracts/daily-window.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import { accessFailure } from "../../domain/access-grant.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import {
  firstAcquisitionRows,
  productAccessOriginSchema,
  type ProductAccessOrigin,
} from "../../shared/product-access-origins.js";

/** The most recent actions one read returns: a feed, not a list. */
export const RECENT_ACCESS_ACTIONS_LIMIT = 20;
/** Products times origins in one holder count; more is refused rather than cut. */
const HOLDER_GROUPS_LIMIT = 10_000;

const productIdSchema = z.uuid().toLowerCase();
const windowSchema = z.object({
  from: z.date(),
  to: z.date(),
  timeZone: z.string().min(1),
});

const newAccessRowsSchema = z.array(
  z.object({
    date: z.iso.date(),
    origin: productAccessOriginSchema,
    value: z.int().nonnegative(),
  }),
);
const actionRowsSchema = z.array(
  z.object({
    kind: z.enum(["issue", "revoke", "restore"]),
    accountId: z.uuid(),
    productId: z.uuid(),
    recordedAt: z.date(),
  }),
);
const originRowsSchema = z.array(
  z.object({
    accountId: z.uuid(),
    productId: z.uuid(),
    origin: productAccessOriginSchema,
  }),
);
const holderRowsSchema = z.array(
  z.object({
    productId: z.uuid(),
    origin: productAccessOriginSchema,
    value: z.int().nonnegative(),
  }),
);

export interface NewAccessDay {
  readonly date: string;
  readonly origin: ProductAccessOrigin;
  readonly value: number;
}

export interface RecentAccessAction {
  /** `issue` is the first acquisition; `revoke` and `restore` are the owner's changes. */
  readonly kind: "issue" | "revoke" | "restore";
  readonly accountId: string;
  readonly productId: string;
  readonly recordedAt: Date;
  /** How this Product Access was first acquired, by the shared first-acquisition rule. */
  readonly origin: ProductAccessOrigin;
}

function productCondition(productId: string | undefined): Prisma.Sql {
  return productId === undefined
    ? Prisma.sql`TRUE`
    : Prisma.sql`a.product_id=${productId}::uuid`;
}

/**
 * Product Access first issued in each calendar day of the window, by first-acquisition origin
 * (the rule of the people list's origin filter). Days without an issue are absent.
 */
export async function readNewAccessByDay(
  prisma: AccountRightsPrismaClient,
  input: DailyWindow,
  productId?: string,
) {
  const window = windowSchema.safeParse(input);
  const product =
    productId === undefined ? undefined : productIdSchema.safeParse(productId);
  if (!window.success || product?.success === false)
    return accessFailure("invalid_input");
  const { from, to, timeZone } = window.data;
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT to_char((f.first_issued_at AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS date,
      f.origin, count(*)::int AS value
    FROM (${firstAcquisitionRows(
      Prisma.sql`a.first_issued_at >= ${from} AND a.first_issued_at < ${to} AND ${productCondition(product?.data)}`,
    )}) f
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  return { ok: true as const, days: newAccessRowsSchema.parse(rows) };
}

/**
 * The latest issues, revocations and restorations, newest first, each with the origin of its
 * Product Access. A source added to an Access that already exists is no issue.
 */
export async function listRecentAccessActions(
  prisma: AccountRightsPrismaClient,
  limit: number,
  productId?: string,
) {
  const take = z.int().min(1).max(RECENT_ACCESS_ACTIONS_LIMIT).safeParse(limit);
  const product =
    productId === undefined ? undefined : productIdSchema.safeParse(productId);
  if (!take.success || product?.success === false)
    return accessFailure("invalid_input");
  const actions = actionRowsSchema.parse(
    await prisma.$queryRaw(Prisma.sql`
      SELECT a.kind, a.account_id::text AS "accountId",
        a.product_id::text AS "productId", a.recorded_at AS "recordedAt"
      FROM account_rights.product_access_actions a
      WHERE a.kind IN ('issue', 'revoke', 'restore') AND ${productCondition(product?.data)}
      ORDER BY a.recorded_at DESC, a.revision DESC, a.id DESC
      LIMIT ${take.data}
    `),
  );
  const pairs = [
    ...new Map(
      actions.map((action) => [
        `${action.accountId}:${action.productId}`,
        Prisma.sql`(${action.accountId}::uuid, ${action.productId}::uuid)`,
      ]),
    ).values(),
  ];
  const origins =
    pairs.length === 0
      ? []
      : originRowsSchema.parse(
          await prisma.$queryRaw(Prisma.sql`
            SELECT f.account_id::text AS "accountId",
              f.product_id::text AS "productId", f.origin
            FROM (${firstAcquisitionRows(
              Prisma.sql`(a.account_id, a.product_id) IN (${Prisma.join(pairs)})`,
            )}) f
          `),
        );
  const originOf = new Map(
    origins.map((row) => [`${row.accountId}:${row.productId}`, row.origin]),
  );
  return {
    ok: true as const,
    items: actions.map((action): RecentAccessAction => ({
      ...action,
      origin:
        originOf.get(`${action.accountId}:${action.productId}`) ?? "unknown",
    })),
  };
}

/** Active Product Access per Product and first-acquisition origin; `productId` narrows to one. */
export async function countActiveHolders(
  prisma: AccountRightsPrismaClient,
  productId?: string,
) {
  const product =
    productId === undefined ? undefined : productIdSchema.safeParse(productId);
  if (product?.success === false) return accessFailure("invalid_input");
  const rows = holderRowsSchema.parse(
    await prisma.$queryRaw(Prisma.sql`
      SELECT f.product_id::text AS "productId", f.origin, count(*)::int AS value
      FROM (${firstAcquisitionRows(
        Prisma.sql`a.revoked_at IS NULL AND ${productCondition(product?.data)}`,
      )}) f
      GROUP BY 1, 2
      ORDER BY 1, 2
      LIMIT ${HOLDER_GROUPS_LIMIT + 1}
    `),
  );
  if (rows.length > HOLDER_GROUPS_LIMIT)
    return dependencyFailure(
      { module: "account-rights", operation: "countActiveHolders" },
      new RangeError("Active holder groups exceed their bound"),
      accessFailure("unavailable"),
    );
  return { ok: true as const, groups: rows };
}
