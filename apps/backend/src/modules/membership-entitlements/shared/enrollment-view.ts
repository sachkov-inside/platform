import { tributeStateSchema } from "../domain/tribute-source.js";
import type { MembershipEntitlementsPrisma } from "../infrastructure/prisma.js";
import { enrollmentViewSchema } from "../domain/subscription-enrollment.js";
export function enrollmentView(
  row: {
    id: string;
    accountId: string;
    snapshot: unknown;
    origin: string;
    startsAt: Date;
    endsAt: Date | null;
    endPolicy: string;
    revision: number;
    revokedAt: Date | null;
  },
  now: Date,
) {
  return enrollmentViewSchema.parse({
    id: row.id,
    accountId: row.accountId,
    tier: row.snapshot,
    origin: row.origin,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    endPolicy: row.endPolicy,
    revision: row.revision,
    state:
      row.revokedAt !== null
        ? "revoked"
        : row.startsAt > now
          ? "scheduled"
          : row.endsAt !== null && row.endsAt <= now
            ? "expired"
            : "active",
    renewal:
      row.origin === "platform_payment"
        ? "billing_agreement"
        : "not_applicable",
    ...(row.origin === "platform_payment" ? {} : { nextChargeAt: null }),
  });
}

export function enrollmentBenefitTerms(
  grants: readonly {
    capabilities: readonly string[];
    startsAt: Date;
    validUntil: Date | null;
    revokedAt: Date | null;
  }[],
) {
  return grants.flatMap((grant) =>
    grant.capabilities.map((capability) => ({
      capability,
      startsAt: grant.startsAt.toISOString(),
      endsAt: grant.validUntil?.toISOString() ?? null,
      revoked: grant.revokedAt !== null,
    })),
  );
}

export async function enrollmentSourceState(
  prisma: MembershipEntitlementsPrisma,
  enrollmentId: string,
  now: Date,
) {
  const source = await prisma.sourceEntitlement.findFirst({
    where: { enrollmentId, origin: "tribute" },
  });
  const state = tributeStateSchema.safeParse(source?.tributeState);
  if (
    !state.success ||
    state.data.mode !== "temporary_membership" ||
    source?.revokedAt != null
  )
    return undefined;
  if (state.data.observation === "source_ended")
    return "suspended_source" as const;
  if (
    state.data.observation !== "member" ||
    state.data.observedUntil === null ||
    Date.parse(state.data.observedUntil) <= now.getTime()
  )
    return "pending_verification" as const;
  return undefined;
}
