import { z } from "zod";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type { AccountRightsPrisma } from "../../infrastructure/prisma.js";
import type { ListAccessHoldersCommand } from "../../domain/access-roster.js";
import {
  ENDING_SOON_WINDOW_MS,
  RECENTLY_ENDED_WINDOW_MS,
} from "../../domain/access-roster.js";
import type { AccessHoldersContext } from "./list-access-holders.js";
import { knownTimedSnapshot } from "./known-timed-snapshot.js";

const idsSchema = z.array(z.object({ id: z.uuid() }));
const accountsSchema = z.array(z.object({ account_id: z.uuid() }));

/**
 * One source snapshot. Aggregate terms and validate each complete immutable snapshot once;
 * uncertain codecs remain Account candidates for exact owner validation.
 */
function enrollmentFacts(
  accounts: readonly string[] | undefined,
  query: ListAccessHoldersCommand | undefined,
  now: Date,
  cursor?: string,
  limit?: number,
): Prisma.Sql {
  const since = new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS);
  const activeOnly = query?.state === "active" || query?.state === "expiring";
  const projection =
    accounts === undefined ? Prisma.sql`DISTINCT account_id` : Prisma.sql`id`;
  const order =
    accounts === undefined ? Prisma.sql`account_id` : Prisma.sql`starts_at, id`;
  const state =
    query === undefined ? Prisma.sql`true` : stateMatches(query, now);
  return Prisma.sql`WITH source_enrollments AS MATERIALIZED (
    SELECT candidate.id, candidate.account_id, candidate.origin, candidate.tier_id,
      candidate.starts_at, candidate.ends_at, candidate.revoked_at, candidate.snapshot
    FROM account_rights.tariff_assignments AS candidate
    WHERE (${accounts === undefined}::boolean OR candidate.account_id = ANY(${accounts ?? []}::uuid[]))
      AND (${query?.source === undefined}::boolean OR candidate.origin = ${query?.source ?? ""})
      AND (${query?.offerId ?? null}::uuid IS NULL OR candidate.tier_id = ${query?.offerId ?? null}::uuid)
      AND (${cursor ?? null}::uuid IS NULL OR candidate.account_id > ${cursor ?? null}::uuid)
      AND (candidate.revoked_at IS NULL OR candidate.revoked_at > ${since})
      AND (NOT ${activeOnly}::boolean OR (candidate.revoked_at IS NULL AND candidate.starts_at <= ${now}))
  ), snapshots AS MATERIALIZED (
    SELECT DISTINCT snapshot FROM source_enrollments WHERE origin IN ('manual','course')
  ), checked_snapshots AS MATERIALIZED (
    SELECT candidate.snapshot, COALESCE(${knownTimedSnapshot()}, false) AS known_timed
    FROM snapshots AS candidate
  ), term_bounds AS MATERIALIZED (
    SELECT ground.enrollment_id, count(*) AS term_count,
      bool_or(ground.valid_until IS NULL) AS unlimited, max(ground.valid_until) AS last_end
    FROM account_rights.access_grants AS ground
    INNER JOIN source_enrollments AS assigned ON assigned.id = ground.enrollment_id
    WHERE assigned.origin IN ('manual','course')
    GROUP BY ground.enrollment_id
  ), effective AS MATERIALIZED (
    SELECT candidate.id, candidate.account_id, candidate.starts_at, candidate.revoked_at,
      candidate.origin IN ('manual','course') AND jsonb_typeof(candidate.snapshot->'benefitPeriods') = 'array'
        AND NOT COALESCE(validation.known_timed, false) AND COALESCE(bounds.term_count, 0) > 0 AS uncertain,
      CASE WHEN COALESCE(validation.known_timed, false) AND COALESCE(bounds.term_count, 0) > 0
        THEN CASE WHEN bounds.unlimited THEN NULL ELSE bounds.last_end END ELSE candidate.ends_at END AS effective_end
    FROM source_enrollments AS candidate
    LEFT JOIN checked_snapshots AS validation ON validation.snapshot = candidate.snapshot
    LEFT JOIN term_bounds AS bounds ON bounds.enrollment_id = candidate.id
  )
    SELECT ${projection} FROM effective
    WHERE ${listed(now)} AND (COALESCE(uncertain, false) OR (${state}))
    ORDER BY ${order} LIMIT ${limit ?? null}`;
}

function listed(now: Date): Prisma.Sql {
  const since = new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS);
  return Prisma.sql`(revoked_at IS NULL OR revoked_at > ${since})
    AND (COALESCE(uncertain, false) OR effective_end IS NULL OR effective_end > ${since})`;
}

function stateMatches(query: ListAccessHoldersCommand, now: Date): Prisma.Sql {
  const since = new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS);
  const soon = new Date(now.getTime() + ENDING_SOON_WINDOW_MS);
  if (query.state === undefined) return Prisma.sql`true`;
  if (query.state === "ended")
    return Prisma.sql`(revoked_at > ${since} OR (revoked_at IS NULL AND starts_at <= ${now} AND effective_end > ${since} AND effective_end <= ${now}))`;
  return Prisma.sql`revoked_at IS NULL AND starts_at <= ${now} AND (effective_end IS NULL OR effective_end > ${now})
    AND (${query.state !== "expiring"}::boolean OR effective_end <= ${soon})`;
}

export async function enrollmentAccountCandidates(
  prisma: AccountRightsPrisma,
  query: ListAccessHoldersCommand,
  now: Date,
  cursor: string | undefined,
  limit: number,
) {
  if (query.source === "one_time_purchase") return [];
  return accountsSchema
    .parse(
      await prisma.$queryRaw(
        enrollmentFacts(undefined, query, now, cursor, limit),
      ),
    )
    .map((row) => row.account_id);
}

export async function rosterEnrollmentIds(
  prisma: AccountRightsPrisma,
  accounts: readonly string[],
  now: Date,
) {
  if (accounts.length === 0) return [];
  return idsSchema
    .parse(await prisma.$queryRaw(enrollmentFacts(accounts, undefined, now)))
    .map((row) => row.id);
}

export async function grantAccountCandidates(
  prisma: AccountRightsPrisma,
  query: ListAccessHoldersCommand,
  now: Date,
  cursor: string | undefined,
  limit: number,
  context: AccessHoldersContext,
) {
  let sources =
    query.source === undefined
      ? ["paid", "manual", "legacy"]
      : query.source === "manual"
        ? ["manual", "legacy"]
        : query.source === "one_time_purchase"
          ? ["paid"]
          : [];
  if (query.offerId !== undefined)
    sources = sources.filter((source) => source === "paid");
  if (
    sources.length === 0 ||
    (query.offerId !== undefined &&
      context.matchOfferPurchaseRefs === undefined &&
      context.offerPurchaseRefs.length === 0)
  )
    return [];
  const since = new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS);
  const soon = new Date(now.getTime() + ENDING_SOON_WINDOW_MS);
  const active = Prisma.sql`revoked_at IS NULL AND starts_at <= ${now} AND (valid_until IS NULL OR valid_until > ${now})`;
  const state =
    query.state === undefined
      ? Prisma.sql`true`
      : query.state === "ended"
        ? Prisma.sql`(revoked_at > ${since} OR (revoked_at IS NULL AND starts_at <= ${now} AND valid_until > ${since} AND valid_until <= ${now}))`
        : query.state === "expiring"
          ? Prisma.sql`(${active} AND valid_until <= ${soon})`
          : active;
  return accountsSchema
    .parse(
      await prisma.$queryRaw(Prisma.sql`
    SELECT DISTINCT account_id FROM account_rights.access_grants AS ground
    WHERE enrollment_id IS NULL AND source = ANY(${sources}::text[])
      AND (revoked_at IS NULL OR revoked_at > ${since}) AND (valid_until IS NULL OR valid_until > ${since})
      AND (${cursor ?? null}::uuid IS NULL OR account_id > ${cursor ?? null}::uuid) AND ${state}
      AND (${query.offerId === undefined || context.matchOfferPurchaseRefs !== undefined}::boolean OR EXISTS (
        SELECT 1 FROM (SELECT unnest(${context.offerPurchaseRefs}::text[]) AS ref) AS purchase WHERE starts_with(ground.source_ref, purchase.ref || ':')
      ))
    ORDER BY account_id LIMIT ${limit}
  `),
    )
    .map((row) => row.account_id);
}

/** Only the longest/null term is needed for roster state; historical terms stay in their owner. */
export async function rosterTimedGrantBounds(
  prisma: AccountRightsPrisma,
  enrollments: readonly string[],
) {
  if (enrollments.length === 0) return [];
  const rows = z
    .array(
      z.object({
        enrollment_id: z.uuid(),
        unlimited: z.boolean(),
        last_end: z.date().nullable(),
      }),
    )
    .parse(
      await prisma.$queryRaw(Prisma.sql`
    SELECT enrollment_id, bool_or(valid_until IS NULL) AS unlimited, max(valid_until) AS last_end
    FROM account_rights.access_grants WHERE enrollment_id = ANY(${enrollments}::uuid[]) GROUP BY enrollment_id
  `),
    );
  return rows.map((row) => ({
    enrollmentId: row.enrollment_id,
    validUntil: row.unlimited ? null : row.last_end,
  }));
}
