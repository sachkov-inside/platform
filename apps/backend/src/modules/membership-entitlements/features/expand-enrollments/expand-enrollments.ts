import { enrollmentView } from "../../shared/enrollment-view.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { accessFailure } from "../../domain/access-grant.js";
import { previewEnrollmentExpansionSchema, applyEnrollmentExpansionSchema, expansionPreviewSchema, tierSnapshotSchema } from "../../domain/subscription-enrollment.js";
import { accessFingerprint, readAccessReceipt } from "../../shared/access-receipts.js";

const storedSchema = z.strictObject({ command: previewEnrollmentExpansionSchema, tier: tierSnapshotSchema });
const expansionPreviewLifetimeMilliseconds = 10 * 60 * 1000;
const appliedSchema = z.strictObject({ ok: z.literal(true), enrollmentIds: z.array(z.uuid()) });
function includesPrevious(previous: z.infer<typeof tierSnapshotSchema>, next: z.infer<typeof tierSnapshotSchema>) {
  return previous.benefits.every(value => next.benefits.includes(value)) &&
    previous.contentScope.guideIds.every(id => next.contentScope.guideIds.includes(id)) &&
    previous.contentScope.materialIds.every(id => next.contentScope.materialIds.includes(id));
}
export async function previewEnrollmentExpansion(prisma: MembershipEntitlementsPrismaClient, actorId: string, input: unknown, tierInput: unknown, now: Date) {
  const parsed = previewEnrollmentExpansionSchema.safeParse(input); const tier = tierSnapshotSchema.safeParse(tierInput);
  if (!parsed.success || !tier.success) return accessFailure("invalid_input");
  const command = parsed.data;
  if (tier.data.id !== command.tierId || tier.data.revision !== command.tierRevision) return accessFailure("revision_conflict");
  return prisma.$transaction(async tx => {
    const fingerprint = accessFingerprint({ command, tier: tier.data });
    const receipt = await readAccessReceipt(tx, actorId, command.operationId);
    if (receipt !== null) return receipt.fingerprint === fingerprint
      ? { ok: true as const, value: expansionPreviewSchema.parse(receipt.result) } : accessFailure("operation_conflict");
    for (const target of command.targets) {
      const row = await tx.subscriptionEnrollment.findUnique({ where: { id: target.enrollmentId } });
      if (row === null) return accessFailure("not_found");
      if (row.revision !== target.expectedRevision || row.tierRevision !== target.tierRevision || row.tierId !== command.tierId) return accessFailure("revision_conflict");
      if (!includesPrevious(tierSnapshotSchema.parse(row.snapshot), tier.data)) return accessFailure("invalid_input");
    }
    const id = randomUUID(); const expiresAt = new Date(now.getTime() + expansionPreviewLifetimeMilliseconds);
    await tx.accessBatchPreview.create({ data: { id, actorId, operationId: command.operationId, fingerprint,
      rows: { command, tier: tier.data }, revision: 1, expiresAt } });
    const value = { previewRef: id, expiresAt: expiresAt.toISOString(), targets: command.targets, tier: tier.data };
    await tx.accessReceipt.create({ data: { scope: actorId, operationId: command.operationId, fingerprint,
      payload: { command, tier: tier.data }, result: value, createdAt: now } });
    return { ok: true as const, value };
  });
}
export async function applyEnrollmentExpansion(prisma: MembershipEntitlementsPrismaClient, actorId: string, input: unknown, now: Date) {
  const parsed = applyEnrollmentExpansionSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  return prisma.$transaction(async tx => {
    const fingerprint = accessFingerprint({ action: "expandEnrollments", command });
    const receipt = await readAccessReceipt(tx, actorId, command.operationId);
    if (receipt !== null) return receipt.fingerprint === fingerprint ? appliedSchema.parse(receipt.result) : accessFailure("operation_conflict");
    const preview = await tx.accessBatchPreview.findUnique({ where: { id: command.previewRef } });
    if (preview === null || preview.actorId !== actorId) return accessFailure("not_found");
    if (preview.expiresAt <= now) return accessFailure("preview_expired");
    const stored = storedSchema.parse(preview.rows);
    const initial = await tx.subscriptionEnrollment.findMany({ where: { id: { in: stored.command.targets.map(row => row.enrollmentId) } } });
    for (const account of [...new Set(initial.map(row => row.accountId))].sort()) await lockAccountEntitlementChanges(tx, account);
    const rows = await tx.subscriptionEnrollment.findMany({ where: { id: { in: stored.command.targets.map(row => row.enrollmentId) } } });
    for (const target of stored.command.targets) {
      const row = rows.find(row => row.id === target.enrollmentId);
      if (row === undefined) return accessFailure("not_found");
      if (row.revision !== target.expectedRevision || row.tierRevision !== target.tierRevision) return accessFailure("revision_conflict");
      if (!includesPrevious(tierSnapshotSchema.parse(row.snapshot), stored.tier)) return accessFailure("invalid_input");
    }
    for (const row of rows) {
      await tx.subscriptionEnrollment.update({ where: { id: row.id }, data: { snapshot: stored.tier, tierRevision: stored.tier.revision, revision: { increment: 1 } } });
      const grants = await tx.accessGrant.findMany({ where: { enrollmentId: row.id } });
      const grant = grants[0];
      if (grant === undefined) throw new Error("Enrollment has no access grant");
      // Preserve each original capability's own paid term; expansion cannot lengthen it.
      await tx.accessGrant.updateMany({ where: { enrollmentId: row.id }, data: { contentScope: stored.tier.contentScope, ...(row.origin === "platform_payment" ? {} : { revision: { increment: 1 } }) } });
      // New capabilities inherit the effective temporary grant, including suspended evidence.
      const temporary = row.origin === "tribute" && row.endPolicy === "temporary_membership";
      const temporaryRevokedAt = grants.find(item => item.revokedAt !== null)?.revokedAt ?? null;
      const temporaryEnds = grants.map(item => item.validUntil).filter((end): end is Date => end !== null);
      const effectiveEnd = temporary && temporaryEnds.length > 0
        ? new Date(Math.min(...temporaryEnds.map(end => end.getTime()), row.endsAt?.getTime() ?? Infinity)) : row.endsAt;
      const previousBenefits = new Set(tierSnapshotSchema.parse(row.snapshot).benefits);
      const added = stored.tier.benefits.filter(value => !previousBenefits.has(value));
      if (added.length > 0) await tx.accessGrant.create({ data: {
        id: randomUUID(), accountId: row.accountId, enrollmentId: row.id,
        source: row.origin === "platform_payment" ? "paid" : "manual", sourceRef: `enrollment:${row.id}:expansion:${stored.tier.revision}`,
        capabilities: added, contentScope: stored.tier.contentScope, startsAt: row.startsAt, validUntil: effectiveEnd,
        revokedAt: row.revokedAt ?? (temporary ? temporaryRevokedAt : null), revision: 1, reason: stored.command.reason,
      } });
      await tx.accessChange.create({ data: { accountId: row.accountId, grantId: grant.id, actorId, operationId: command.operationId,
        kind: "enrollment_expanded", reason: stored.command.reason, recordedAt: now } });
    }
    const result = { ok: true as const, enrollmentIds: rows.map(row => row.id) };
    await tx.accessReceipt.create({ data: { scope: actorId, operationId: command.operationId, fingerprint,
      payload: { command, before: rows.map(row => enrollmentView(row, now)), tier: stored.tier }, result, createdAt: now } });
    return result;
  });
}
