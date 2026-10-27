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

/** Factual provenance only. Historical rows never participate in current access decisions. */
export async function readProductAccessOrigins(
  prisma: AccountRightsPrisma,
  accountId: string,
  productIds: readonly string[],
) {
  if (productIds.length === 0)
    return new Map<string, z.infer<typeof productAccessOriginSchema>[]>();
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT DISTINCT a.product_id::text AS "productId",
      CASE s.source
        WHEN 'purchase' THEN 'paid'
        WHEN 'manual' THEN 'manual'
        WHEN 'course_activation' THEN 'course_activation'
        WHEN 'legacy' THEN 'legacy'
        WHEN 'migration_grant' THEN CASE WHEN g.source IN ('paid','manual','legacy') THEN g.source ELSE 'unknown' END
        ELSE 'unknown'
      END AS source
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
    WHERE a.account_id=${accountId}::uuid AND a.product_id IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "productId", source
  `);
  const parsed = z
    .array(z.object({ productId: z.uuid(), source: productAccessOriginSchema }))
    .parse(rows);
  const origins = new Map<
    string,
    z.infer<typeof productAccessOriginSchema>[]
  >();
  for (const row of parsed) {
    const sources = origins.get(row.productId) ?? [];
    sources.push(row.source);
    origins.set(row.productId, sources);
  }
  return origins;
}
