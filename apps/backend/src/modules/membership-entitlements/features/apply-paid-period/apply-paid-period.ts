import { tierSnapshotSchema } from "../../domain/subscription-enrollment.js";
import { lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import {
  accessFailure,
  accessFailureSchema,
  grantSuccessSchema,
  grantTermsSchema,
  sourceRefSchema,
} from "../../domain/access-grant.js";
import {
  accessFingerprint,
  readAccessReceipt,
} from "../../shared/access-receipts.js";

export const paidPeriodCommandSchema = z
  .object({
    eventRef: z.uuid(),
    periodRef: sourceRefSchema,
    accountId: z.uuid(),
    revision: z.number().int().positive(),
    revoked: z.boolean(),
    terms: grantTermsSchema,
    enrollment: z.strictObject({ purchaseRef: z.uuid(), billingRef: z.uuid(), tier: tierSnapshotSchema,
      startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), benefitTerms: z.array(grantTermsSchema).min(1).max(100).optional() }).optional(),
  })
  .strict();
const paidResultSchema = z.union([
  grantSuccessSchema,
  accessFailureSchema([
    "invalid_input",
    "not_found",
    "revision_conflict",
    "operation_conflict",
  ]),
]);
type PaidPeriodResult = z.infer<typeof paidResultSchema>;
export type ApplyPaidPeriodCommand = z.input<typeof paidPeriodCommandSchema>;

// Trusted billing projector only. No transport exposes this payment-proof boundary.
export async function applyPaidPeriod(
  prisma: MembershipEntitlementsPrismaClient,
  accounts: Pick<Accounts, "readIdentityForLink">,
  input: ApplyPaidPeriodCommand,
  now: Date,
): Promise<PaidPeriodResult> {
  const parsed = paidPeriodCommandSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  if ((await accounts.readIdentityForLink(command.accountId)) === undefined)
    return accessFailure("not_found");
  const fingerprint = accessFingerprint(command);
  return prisma.$transaction(async (transaction) => {
    const receipt = await readAccessReceipt(
      transaction,
      "paid-period",
      command.eventRef,
    );
    if (receipt !== null)
      return receipt.fingerprint === fingerprint
        ? paidResultSchema.parse(receipt.result)
        : accessFailure("operation_conflict");
    await lockAccountEntitlementChanges(transaction, command.accountId);
    await lockAccess(transaction, `paid:${command.periodRef}`);
    const existing = await transaction.accessGrant.findUnique({
      where: {
        source_sourceRef: { source: "paid", sourceRef: command.periodRef },
      },
    });
    if (existing !== null && existing.accountId !== command.accountId)
      return accessFailure("operation_conflict");
    if (existing !== null && command.revision <= existing.revision)
      return accessFailure("revision_conflict");
    let contentScope = command.terms.contentScope;
    let enrollmentId = existing?.enrollmentId ?? null;
    let enrollmentRevokedAt: Date | null = null;
    if (enrollmentId === null && command.enrollment === undefined) {
      const purchaseRef = command.periodRef.split(":")[0];
      if (z.uuid().safeParse(purchaseRef).success) {
        const imported = await transaction.subscriptionEnrollment.findUnique({ where: { origin_sourceRef: { origin: "platform_payment", sourceRef: `purchase:${purchaseRef ?? ""}` } } });
        if (imported !== null && imported.accountId !== command.accountId) return accessFailure("operation_conflict");
        enrollmentId = imported?.id ?? null;
      }
    }
    if (command.enrollment !== undefined) {
      const paid = command.enrollment; const sourceRef = `purchase:${paid.purchaseRef}`;
      const prior = await transaction.subscriptionEnrollment.findUnique({ where: { origin_sourceRef: { origin: "platform_payment", sourceRef } } });
      if (prior !== null && prior.accountId !== command.accountId) return accessFailure("operation_conflict");
      const enrollment = prior ?? await transaction.subscriptionEnrollment.create({ data: {
        id: randomUUID(), accountId: command.accountId, tierId: paid.tier.id, tierRevision: paid.tier.revision,
        snapshot: paid.tier, origin: "platform_payment", sourceRef, startsAt: new Date(paid.startsAt), endsAt: new Date(paid.endsAt),
        endPolicy: "fixed", billingRef: paid.billingRef, revision: 1, reason: command.terms.reason,
      } });
      enrollmentId = enrollment.id;
      contentScope = tierSnapshotSchema.parse(enrollment.snapshot).contentScope;
      enrollmentRevokedAt = enrollment.revokedAt;
      if (command.revoked && enrollment.revokedAt === null) {
        enrollmentRevokedAt = now;
        await transaction.subscriptionEnrollment.update({ where: { id: enrollment.id }, data: { revokedAt: now, revision: { increment: 1 } } });
        await transaction.accessGrant.updateMany({ where: { enrollmentId: enrollment.id }, data: { revokedAt: now } });
      }
    }
    if (command.enrollment === undefined && enrollmentId !== null) {
      const imported = await transaction.subscriptionEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      contentScope = tierSnapshotSchema.parse(imported.snapshot).contentScope;
      enrollmentRevokedAt = imported.revokedAt;
      if (command.revoked && imported.revokedAt === null) {
        enrollmentRevokedAt = now;
        await transaction.subscriptionEnrollment.update({ where: { id: enrollmentId }, data: { revokedAt: now, revision: { increment: 1 } } });
        await transaction.accessGrant.updateMany({ where: { enrollmentId }, data: { revokedAt: now } });
      }
    }
    const grantRef = existing?.id ?? randomUUID();
    const data = {
      accountId: command.accountId,
      source: "paid",
      enrollmentId,
      ...(contentScope === undefined ? {} : { contentScope }),
      sourceRef: command.periodRef,
      capabilities: command.terms.capabilities,
      startsAt: new Date(command.terms.startsAt),
      validUntil:
        command.terms.validUntil === null
          ? null
          : new Date(command.terms.validUntil),
      revokedAt: enrollmentRevokedAt ?? (command.revoked ? now : existing?.revokedAt ?? null),
      revision: command.revision,
      reason: command.terms.reason,
    };
    await transaction.accessGrant.upsert({
      where: { id: grantRef },
      create: { id: grantRef, ...data },
      update: data,
    });
    // New paid enrollments project the full promised composition atomically. Old single-capability
    // outbox messages remain readable; they keep their own source revisions and terms.
    for (const terms of command.enrollment?.benefitTerms ?? []) {
      for (const capability of terms.capabilities) {
        const sourceRef = `${command.enrollment?.purchaseRef ?? ""}:${capability}`;
        if (sourceRef === command.periodRef) continue;
        const current = await transaction.accessGrant.findUnique({ where: { source_sourceRef: { source: "paid", sourceRef } } });
        if (current !== null && current.accountId !== command.accountId) throw new Error("Paid composition account conflict");
        if (current !== null && current.revision >= command.revision) continue;
        const id = current?.id ?? randomUUID();
        const benefit = { ...data, sourceRef, capabilities: [capability], startsAt: new Date(terms.startsAt),
          validUntil: terms.validUntil === null ? null : new Date(terms.validUntil),
          revokedAt: data.revokedAt ?? current?.revokedAt ?? null };
        await transaction.accessGrant.upsert({ where: { id }, create: { id, ...benefit }, update: benefit });
        await transaction.accessChange.create({ data: { accountId: command.accountId, grantId: id, operationId: command.eventRef,
          kind: command.revoked ? "paid_revoked" : "paid_applied", reason: command.terms.reason, recordedAt: now } });
      }
    }
    const result = { ok: true as const, grantRef, revision: command.revision };
    await transaction.accessReceipt.create({
      data: {
        scope: "paid-period",
        operationId: command.eventRef,
        fingerprint,
        payload: command,
        result,
        createdAt: now,
      },
    });
    await transaction.accessChange.create({
      data: {
        accountId: command.accountId,
        grantId: grantRef,
        operationId: command.eventRef,
        kind: command.revoked ? "paid_revoked" : "paid_applied",
        reason: command.terms.reason,
        recordedAt: now,
      },
    });
    return result;
  });
}
