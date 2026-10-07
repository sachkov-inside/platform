import type { MembershipEntitlementsPrismaClient } from "../infrastructure/prisma.js";
import {
  accessGroundState,
  ENDING_SOON_WINDOW_MS,
  RECENTLY_ENDED_WINDOW_MS,
} from "../domain/access-roster.js";
import { tierSnapshotSchema } from "../domain/subscription-enrollment.js";

/** Owner reports count current rights; an unlimited assignment can have only finite rights. */
export async function readTimedEnrollmentAccess(
  prisma: MembershipEntitlementsPrismaClient,
  now: Date,
) {
  const rows = await prisma.subscriptionEnrollment.findMany({
    where: { origin: { in: ["manual", "course"] } },
  });
  const timed = rows.filter((row) => {
    const snapshot = tierSnapshotSchema.safeParse(row.snapshot);
    return snapshot.success && snapshot.data.benefitPeriods !== undefined;
  });
  const grants = await prisma.accessGrant.findMany({
    where: { enrollmentId: { in: timed.map((row) => row.id) } },
    select: { enrollmentId: true, validUntil: true },
  });
  const byEnrollment = new Map<string, typeof grants>();
  for (const grant of grants) {
    if (grant.enrollmentId === null) continue;
    const terms = byEnrollment.get(grant.enrollmentId) ?? [];
    terms.push(grant);
    byEnrollment.set(grant.enrollmentId, terms);
  }
  const since = new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS);
  const soon = new Date(now.getTime() + ENDING_SOON_WINDOW_MS);
  return timed.flatMap((row) => {
    const terms = byEnrollment.get(row.id);
    if (terms === undefined || terms.length === 0) return [];
    const endsAt = terms.some((term) => term.validUntil === null)
      ? null
      : new Date(
          Math.max(...terms.map((term) => term.validUntil?.getTime() ?? 0)),
        );
    const state = accessGroundState({ ...row, endsAt }, now);
    return [
      {
        id: row.id,
        state,
        listed:
          (row.revokedAt === null || row.revokedAt > since) &&
          (endsAt === null || endsAt > since),
        expiring: state === "active" && endsAt !== null && endsAt <= soon,
      },
    ];
  });
}
export type TimedEnrollmentAccess = Awaited<
  ReturnType<typeof readTimedEnrollmentAccess>
>;
