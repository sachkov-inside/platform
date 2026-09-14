import type { z } from "zod";
import type { MembershipEntitlementsPrisma } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import { sourceIdentityRef } from "../../domain/source-identity.js";
import { tributeStateSchema } from "../../domain/tribute-source.js";
import { ACTIVATION_CONTRACT_VERSION, type ActivationOutcome, type activationEvidenceSchema } from "../../domain/subscription-activation.js";
import type { TierSnapshot } from "../../domain/subscription-enrollment.js";
import { enrollmentSourceState, enrollmentView } from "../../shared/enrollment-view.js";
import { projectTributeSource } from "../../shared/tribute-source.js";

/** The caller already locked and validated exact current binding, attempt, rule and catalog. */
export async function activateTributeRegistry(tx: MembershipEntitlementsPrisma, policyRef: string, accountId: string,
  request: z.infer<typeof activationEvidenceSchema>, tier: TierSnapshot, now: Date): Promise<ActivationOutcome> {
  const pending: ActivationOutcome = { contractVersion: ACTIVATION_CONTRACT_VERSION, attemptId: request.attemptId,
    state: "pending_review", enrollment: null };
  const sourceRef = sourceIdentityRef("tribute", policyRef, request.identityRef);
  await lockAccess(tx, `enrollment:tribute:${sourceRef}`);
  await lockAccess(tx, "tribute:policies");
  const policy = await tx.tributePolicy.findUnique({ where: { id: policyRef } });
  if (!policy?.enabled) return pending;
  const source = await tx.sourceEntitlement.findUnique({ where: { origin_sourceRef: { origin: "tribute", sourceRef } } });
  const parsed = tributeStateSchema.safeParse(source?.tributeState);
  if (source === null || !parsed.success || source.revokedAt !== null || (source.accountId !== null && source.accountId !== accountId)) return pending;
  const state = parsed.data;
  if (state.tier.id !== tier.id || state.subscriptionId !== policy.subscriptionId) return pending;
  // The registry snapshot defines the promised scope and term. No chat proof, amount or code can replace it.
  const existing = source.enrollmentId !== null;
  if (!existing) {
    const projected = await projectTributeSource(tx, source, state, accountId, null, "Verified Tribute registry activation", now);
    if (!projected.ok || projected.enrollmentId === null) return pending;
  }
  const attached = await tx.sourceEntitlement.findUniqueOrThrow({ where: { id: source.id } });
  if (attached.enrollmentId === null) return pending;
  const row = await tx.subscriptionEnrollment.findUniqueOrThrow({ where: { id: attached.enrollmentId } });
  const enrollment = enrollmentView(row, now);
  const sourceState = await enrollmentSourceState(tx, row.id, now);
  if (sourceState !== undefined && enrollment.state !== "revoked") enrollment.state = sourceState;
  return { contractVersion: ACTIVATION_CONTRACT_VERSION, attemptId: request.attemptId,
    state: enrollment.state === "active" ? existing ? "already_active" : "active" : "pending_review", enrollment };
}
