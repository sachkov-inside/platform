import type { ActivationBindings } from "../../domain/subscription-activation.js";
import { enrollmentView } from "../../shared/enrollment-view.js";
import type { z } from "zod";
import { randomUUID } from "node:crypto";
import { lockTelegramAccountBinding, lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import type { MembershipEntitlementsPrismaClient, MembershipEntitlementsPrisma } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import { accessFailure } from "../../domain/access-grant.js";
import { assignEnrollmentSchema, enrollmentResultSchema, tierSnapshotSchema, type EnrollmentResult } from "../../domain/subscription-enrollment.js";
import { accessFingerprint, readAccessReceipt } from "../../shared/access-receipts.js";

/** Caller holds catalog eligibility stable until this transaction commits. */
export async function assignEnrollment(prisma: MembershipEntitlementsPrismaClient, actorId: string, input: unknown, tierInput: unknown, now: Date, bindings?: Pick<ActivationBindings, "readBinding">): Promise<EnrollmentResult> {
  const parsed = assignEnrollmentSchema.safeParse(input);
  const snapshot = tierSnapshotSchema.safeParse(tierInput);
  if (!parsed.success || !snapshot.success) return accessFailure("invalid_input");
  const command = parsed.data;
  // Temporary Tribute assignments require registry audience and fresh source evidence.
  if (command.origin === "tribute" && command.terms.endPolicy === "temporary_membership") return accessFailure("invalid_input");
  if (snapshot.data.id !== command.tierId || snapshot.data.revision !== command.tierRevision) return accessFailure("revision_conflict");
  return prisma.$transaction(async tx => {
    const receipt = await readAccessReceipt(tx, actorId, command.operationId);
    if (receipt !== null) return receipt.fingerprint === accessFingerprint({ action: "assignEnrollment", command })
      ? enrollmentResultSchema.parse(receipt.result) : accessFailure("operation_conflict");
    if (command.origin === "course" && command.courseSource !== undefined) {
      await lockTelegramAccountBinding(tx, command.accountId);
      const current = await bindings?.readBinding({ accountId: command.accountId });
      if (current === undefined || !current.ok) return accessFailure("unavailable");
      if (current.binding?.accountRef == null || current.binding.telegramIdentityRef !== command.courseSource.verifiedIdentityRef)
        return accessFailure("identity_conflict");
    }
    return assignEnrollmentInTransaction(tx, actorId, command, snapshot.data, now);
  });
}

export async function assignEnrollmentInTransaction(tx: MembershipEntitlementsPrisma, actorId: string | null,
  command: z.infer<typeof assignEnrollmentSchema>, tier: z.infer<typeof tierSnapshotSchema>, now: Date): Promise<EnrollmentResult> {
  const fingerprint = accessFingerprint({ action: "assignEnrollment", command });
    const receipt = await readAccessReceipt(tx, actorId ?? "activation", command.operationId);
    if (receipt !== null) return receipt.fingerprint === fingerprint ? enrollmentResultSchema.parse(receipt.result) : accessFailure("operation_conflict");
    await lockAccess(tx, `enrollment:${command.origin}:${command.sourceRef}`);
    await lockAccountEntitlementChanges(tx, command.accountId);
    const existing = await tx.subscriptionEnrollment.findUnique({ where: { origin_sourceRef: { origin: command.origin, sourceRef: command.sourceRef } } });
    if (existing !== null && existing.accountId !== command.accountId) return accessFailure("identity_conflict");
    const terms = command.terms;
    if (command.origin === "course" && command.courseSource !== undefined) {
      const source = await tx.sourceEntitlement.findUnique({ where: { origin_sourceRef: { origin: "course", sourceRef: command.sourceRef } } });
      if (source !== null && source.accountId !== null && source.accountId !== command.accountId) return accessFailure("identity_conflict");
    }
    const row = existing ?? await tx.subscriptionEnrollment.create({ data: {
      id: randomUUID(), accountId: command.accountId, tierId: command.tierId, tierRevision: command.tierRevision,
      snapshot: tier, origin: command.origin, sourceRef: command.sourceRef,
      startsAt: command.origin === "course" ? now : new Date(terms.startsAt),
      endsAt: terms.endsAt === null ? null : new Date(terms.endsAt), endPolicy: terms.endPolicy,
      billingRef: command.billingRef, revision: 1, reason: command.reason,
    } });
    if (existing === null) {
      const grantId = randomUUID();
      await tx.accessGrant.create({ data: {
        id: grantId, accountId: row.accountId, source: row.origin === "platform_payment" ? "paid" : "manual",
        sourceRef: `enrollment:${row.id}`, enrollmentId: row.id, capabilities: tier.benefits,
        contentScope: tier.contentScope, startsAt: row.startsAt, validUntil: row.endsAt,
        revision: 1, reason: command.reason,
      } });
      await tx.accessChange.create({ data: { accountId: row.accountId, grantId, actorId, operationId: command.operationId,
        kind: "enrollment_assigned", reason: command.reason, recordedAt: now } });
    }
    if (command.origin === "course" && command.courseSource !== undefined) {
      await tx.sourceEntitlement.upsert({ where: { origin_sourceRef: { origin: "course", sourceRef: command.sourceRef } },
        create: { id: randomUUID(), origin: "course", sourceRef: command.sourceRef, sourcePolicyRef: command.courseSource.policyRef,
          identityRef: command.courseSource.verifiedIdentityRef, accountId: row.accountId, enrollmentId: row.id,
          revision: 1, evidence: { method: "owner_confirmation", actorId, reason: command.reason }, checkedAt: now },
        update: { accountId: row.accountId, enrollmentId: row.id } });
    }
    const result = { ok: true as const, value: enrollmentView(row, now) };
    await tx.accessReceipt.create({ data: { scope: actorId ?? "activation", operationId: command.operationId, fingerprint,
      payload: { command, before: existing === null ? null : enrollmentView(existing, now), after: result.value }, result, createdAt: now } });
    return result;
}
