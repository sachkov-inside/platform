import { z } from "zod";
import { Prisma } from "../../../infrastructure/prisma/index.js";
import type { AccountRightsPrisma } from "../infrastructure/prisma.js";

export const productAccessOriginSchema = z.enum([
  "paid",
  "manual",
  "legacy",
  "course_activation",
  "unknown",
]);
export type ProductAccessOrigin = z.infer<typeof productAccessOriginSchema>;

/**
 * One row per Product Access source (a Product Access without a source yields one row with null
 * source columns) and the origin rule every provenance read shares: `purchase` is `paid`, a
 * migrated grant keeps its original grant source when the migration inventory proves it, anything
 * else is `unknown`. `where` filters the `product_access a` rows.
 */
function originRows(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT a.account_id, a.product_id, a.revoked_at, a.first_issued_at,
      s.source AS source_kind, s.source_ref, s.issued_at, s.reason,
      CASE s.source
        WHEN 'purchase' THEN 'paid'
        WHEN 'manual' THEN 'manual'
        WHEN 'course_activation' THEN 'course_activation'
        WHEN 'legacy' THEN 'legacy'
        WHEN 'migration_grant' THEN CASE WHEN g.source IN ('paid','manual','legacy') THEN g.source ELSE 'unknown' END
        ELSE 'unknown'
      END AS origin
    FROM account_rights.product_access a
    LEFT JOIN account_rights.product_access_sources s
      ON s.account_id=a.account_id AND s.product_id=a.product_id
    LEFT JOIN account_rights.access_grants g
      ON s.source='migration_grant'
      AND g.id=CASE WHEN s.source_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN split_part(s.source_ref,':',1)::uuid ELSE NULL END
      AND s.source_ref=g.id::text||':'||a.product_id::text
      AND g.account_id=a.account_id
      AND (g.capabilities @> ARRAY['product:'||a.product_id::text]::text[]
        OR (g.capabilities @> ARRAY['materials']::text[]
          AND coalesce(g.coverage->'productIds','[]'::jsonb) @> to_jsonb(ARRAY[a.product_id::text])))
      AND EXISTS (SELECT 1 FROM account_rights.product_access_migration_inventory i
        WHERE i.legacy_kind='grant' AND i.legacy_id=g.id
        AND i.account_id=a.account_id AND a.product_id=ANY(i.product_ids))
    WHERE ${where}`;
}

/**
 * The first acquisition of each Product Access: `first_issued_at` is written from the `issuedAt`
 * of the source that first acquired it, so its origin is the origin of the sources issued at that
 * instant. No such source, or sources of different origins at that instant, is `unknown`.
 */
export function firstAcquisitionRows(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT o.account_id, o.product_id, (o.revoked_at IS NULL) AS active,
      o.first_issued_at,
      CASE WHEN count(DISTINCT o.origin) FILTER (WHERE o.issued_at = o.first_issued_at) = 1
        THEN min(o.origin) FILTER (WHERE o.issued_at = o.first_issued_at)
        ELSE 'unknown' END AS origin
    FROM (${originRows(where)}) o
    GROUP BY o.account_id, o.product_id, o.revoked_at, o.first_issued_at`;
}

function uuidList(ids: readonly string[]): Prisma.Sql {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
}

/** Factual provenance only. Historical rows never participate in current access decisions. */
export async function readProductAccessOrigins(
  prisma: AccountRightsPrisma,
  accountId: string,
  productIds: readonly string[],
) {
  if (productIds.length === 0) return new Map<string, ProductAccessOrigin[]>();
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT DISTINCT o.product_id::text AS "productId", o.origin AS source
    FROM (${originRows(
      Prisma.sql`a.account_id=${accountId}::uuid AND a.product_id IN (${uuidList(productIds)})`,
    )}) o
    ORDER BY "productId", source
  `);
  const parsed = z
    .array(z.object({ productId: z.uuid(), source: productAccessOriginSchema }))
    .parse(rows);
  const origins = new Map<string, ProductAccessOrigin[]>();
  for (const row of parsed) {
    const sources = origins.get(row.productId) ?? [];
    sources.push(row.source);
    origins.set(row.productId, sources);
  }
  return origins;
}

const firstAcquisitionRowSchema = z.object({
  accountId: z.uuid(),
  productId: z.uuid(),
  active: z.boolean(),
  origin: productAccessOriginSchema,
});

/** Every Product Access of the given Accounts with its state and first acquisition origin. */
export async function readFirstAcquisitionOrigins(
  prisma: AccountRightsPrisma,
  accountIds: readonly string[],
  limit: number,
) {
  if (accountIds.length === 0) return [];
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT f.account_id::text AS "accountId", f.product_id::text AS "productId",
      f.active, f.origin
    FROM (${firstAcquisitionRows(
      Prisma.sql`a.account_id IN (${uuidList(accountIds)})`,
    )}) f
    ORDER BY "accountId", "productId"
    LIMIT ${limit}
  `);
  return z.array(firstAcquisitionRowSchema).parse(rows);
}

/**
 * Accounts holding at least one Product Access that satisfies every given filter together; the
 * origin filter compares the first acquisition origin. At most `limit` Account IDs, ascending.
 */
export async function listAccountsWithProductAccess(
  prisma: AccountRightsPrisma,
  filter: {
    readonly productId?: string | undefined;
    readonly origin?: ProductAccessOrigin | undefined;
    readonly state?: "active" | "revoked" | undefined;
  },
  limit: number,
) {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filter.productId !== undefined)
    conditions.push(Prisma.sql`a.product_id=${filter.productId}::uuid`);
  if (filter.state === "active")
    conditions.push(Prisma.sql`a.revoked_at IS NULL`);
  if (filter.state === "revoked")
    conditions.push(Prisma.sql`a.revoked_at IS NOT NULL`);
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT DISTINCT f.account_id::text AS "accountId"
    FROM (${firstAcquisitionRows(Prisma.join(conditions, " AND "))}) f
    WHERE ${filter.origin === undefined ? Prisma.sql`TRUE` : Prisma.sql`f.origin=${filter.origin}`}
    ORDER BY "accountId"
    LIMIT ${limit}
  `);
  return z
    .array(z.object({ accountId: z.uuid() }))
    .parse(rows)
    .map((row) => row.accountId);
}

const sourceOriginRowSchema = z.object({
  productId: z.uuid(),
  source: z.string(),
  sourceRef: z.string(),
  issuedAt: z.date(),
  reason: z.string(),
  origin: productAccessOriginSchema,
});

/** Every source of one Account's Product Access with the origin it proves. */
export async function readSourceOrigins(
  prisma: AccountRightsPrisma,
  accountId: string,
  limit: number,
) {
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT o.product_id::text AS "productId", o.source_kind AS source,
      o.source_ref AS "sourceRef", o.issued_at AS "issuedAt", o.reason, o.origin
    FROM (${originRows(Prisma.sql`a.account_id=${accountId}::uuid`)}) o
    WHERE o.source_kind IS NOT NULL
    ORDER BY "productId", "issuedAt", source, "sourceRef"
    LIMIT ${limit}
  `);
  return z.array(sourceOriginRowSchema).parse(rows);
}
