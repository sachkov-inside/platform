import { randomUUID } from "node:crypto";
import { tributeSourceViewSchema, tributeStateSchema, type TributeState } from "../domain/tribute-source.js";
import type { MembershipEntitlementsPrisma } from "../infrastructure/prisma.js";
import { assignEnrollmentInTransaction } from "../features/assign-enrollment/assign-enrollment.js";
import { lockAccountEntitlementChanges } from "../../../infrastructure/prisma/index.js";

export interface TributeSourceRecord {
  id: string; sourceRef: string; sourcePolicyRef: string; identityRef: string;
  accountId: string | null; enrollmentId: string | null; revision: number;
  revokedAt: Date | null; checkedAt: Date; tributeState: unknown;
}
export function tributeSourceView(row: TributeSourceRecord, now: Date) {
  const state = tributeStateSchema.parse(row.tributeState);
  return tributeSourceViewSchema.parse({ id: row.id, sourceRef: row.sourceRef, policyRef: row.sourcePolicyRef,
    identityRef: row.identityRef, revision: row.revision, accountId: row.accountId, enrollmentId: row.enrollmentId,
    revoked: row.revokedAt !== null, checkedAt: row.checkedAt.toISOString(), state,
    status: row.revokedAt !== null ? "revoked" : state.observation === "source_ended" && state.mode === "temporary_membership"
      ? "suspended_source" : row.accountId === null ? "pending_identity"
      : state.mode === "temporary_membership" && (state.observation !== "member" || state.observedUntil === null || new Date(state.observedUntil) <= now)
        ? "pending_verification" : new Date(state.startsAt) > now ? "scheduled" : new Date(state.endsAt) <= now ? "expired" : "active" });
}
/**
 * Caller holds exact binding/source/catalog guards. Before any earlier source-row mutation,
 * it must also acquire all affected account locks in sorted order; this reentrant lock is too late otherwise.
 * Generic owner changes acquire account before rows and must never acquire source guards afterward.
 */
export async function projectTributeSource(tx: MembershipEntitlementsPrisma, row: TributeSourceRecord,
  state: TributeState, accountId: string, actorId: string | null, reason: string, now: Date) {
  await lockAccountEntitlementChanges(tx, accountId);
  if (row.accountId !== null && row.accountId !== accountId) return { ok: false as const, error: { code: "identity_conflict" as const } };
  const existing = row.enrollmentId === null ? null : await tx.subscriptionEnrollment.findUnique({ where: { id: row.enrollmentId } });
  // A revoke from either existing owner surface is a durable source tombstone.
  if (row.revokedAt !== null || existing?.revokedAt != null) {
    if (row.revokedAt === null && existing?.revokedAt != null) await tx.sourceEntitlement.update({ where: { id: row.id }, data: { revokedAt: existing.revokedAt } });
    return { ok: true as const, enrollmentId: row.enrollmentId };
  }
  const temporary = state.mode === "temporary_membership";
  const end = temporary && state.observedUntil !== null
    ? new Date(Math.min(Date.parse(state.endsAt), Date.parse(state.observedUntil))) : new Date(state.endsAt);
  const suspended = temporary && (state.observation !== "member" || state.observedUntil === null || end <= now);
  const safeEnd = end > new Date(state.startsAt) ? end : new Date(state.endsAt);
  const operationId = randomUUID();
  let enrollmentId = row.enrollmentId;
  if (existing === null) {
    const result = await assignEnrollmentInTransaction(tx, actorId, { operationId, accountId, origin: "tribute",
      sourceRef: row.sourceRef, tierId: state.tier.id, tierRevision: state.tier.revision,
      terms: { startsAt: state.startsAt, endsAt: safeEnd.toISOString(), endPolicy: temporary ? "temporary_membership" : "confirmed_external" },
      billingRef: null, reason }, state.tier, now);
    if (!result.ok) return result;
    enrollmentId = result.value.id;
    if (suspended) await tx.accessGrant.updateMany({ where: { enrollmentId }, data: { revokedAt: now } });
  } else {
    const startsAt = new Date(state.startsAt);
    // Temporary loss suspends grants; it is not an owner revoke of the Enrollment.
    await tx.subscriptionEnrollment.update({ where: { id: existing.id }, data: {
      startsAt, endsAt: end > startsAt ? end : existing.endsAt,
      endPolicy: temporary ? "temporary_membership" : "confirmed_external", revision: { increment: 1 }, reason,
    } });
    await tx.accessGrant.updateMany({ where: { enrollmentId: existing.id }, data: {
      startsAt, validUntil: end > startsAt ? end : existing.endsAt,
      revokedAt: suspended ? now : null, revision: { increment: 1 }, reason,
    } });
    await tx.accessChange.create({ data: { accountId, actorId, operationId, kind: "tribute_source_changed", reason, recordedAt: now } });
  }
  await tx.sourceEntitlement.update({ where: { id: row.id }, data: { accountId, enrollmentId } });
  // A classified Tribute source replaces only its legacy compatibility bridge, never independent grants.
  await tx.legacyClassification.updateMany({ where: { accountId, bridgeEnabled: true }, data: { bridgeEnabled: false, revision: { increment: 1 } } });
  return { ok: true as const, enrollmentId };
}
