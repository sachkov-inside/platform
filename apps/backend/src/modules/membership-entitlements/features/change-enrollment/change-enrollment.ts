import { enrollmentView } from "../../shared/enrollment-view.js";
import { lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { accessFailure } from "../../domain/access-grant.js";
import { changeEnrollmentSchema, enrollmentResultSchema, type EnrollmentResult } from "../../domain/subscription-enrollment.js";
import { accessFingerprint, readAccessReceipt } from "../../shared/access-receipts.js";

export async function changeEnrollment(prisma: MembershipEntitlementsPrismaClient, actorId: string, input: unknown, now: Date): Promise<EnrollmentResult> {
  const parsed = changeEnrollmentSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  const fingerprint = accessFingerprint({ action: "changeEnrollment", command });
  return prisma.$transaction(async tx => {
    const receipt = await readAccessReceipt(tx, actorId, command.operationId);
    if (receipt !== null) return receipt.fingerprint === fingerprint ? enrollmentResultSchema.parse(receipt.result) : accessFailure("operation_conflict");
    const target = await tx.subscriptionEnrollment.findUnique({ where: { id: command.enrollmentId } });
    if (target === null) return accessFailure("not_found");
    await lockAccountEntitlementChanges(tx, target.accountId);
    const row = await tx.subscriptionEnrollment.findUnique({ where: { id: command.enrollmentId } });
    if (row === null) return accessFailure("not_found");
    if (row.revision !== command.expectedRevision) return accessFailure("revision_conflict");
    if (row.origin === "tribute" && (command.terms.endsAt === null || command.terms.endPolicy === "fixed")) return accessFailure("invalid_input");
    if (row.origin === "course" && command.terms.endPolicy !== "fixed") return accessFailure("invalid_input");
    if (row.origin === "platform_payment") return accessFailure("forbidden");
    if (row.origin === "course" && (command.terms.endsAt !== null || new Date(command.terms.startsAt).getTime() !== row.startsAt.getTime())) return accessFailure("invalid_input");
    if (command.action === "restore" && row.revokedAt === null) return accessFailure("revision_conflict");
    const before = enrollmentView(row, now);
    const data = { revision: row.revision + 1, reason: command.reason,
      revokedAt: command.action === "revoke" ? row.revokedAt ?? now : command.action === "restore" ? null : row.revokedAt,
      startsAt: command.action === "revoke" ? row.startsAt : new Date(command.terms.startsAt),
      endsAt: command.action === "revoke" ? row.endsAt : command.terms.endsAt === null ? null : new Date(command.terms.endsAt),
      endPolicy: command.action === "revoke" ? row.endPolicy : command.terms.endPolicy,
    };
    const updated = await tx.subscriptionEnrollment.update({ where: { id: row.id }, data });
    const grant = await tx.accessGrant.findFirstOrThrow({ where: { enrollmentId: row.id } });
    await tx.accessGrant.updateMany({ where: { enrollmentId: row.id }, data: {
      revision: { increment: 1 }, reason: data.reason, revokedAt: data.revokedAt, startsAt: data.startsAt, validUntil: data.endsAt,
    } });
    const result = { ok: true as const, value: enrollmentView(updated, now) };
    await tx.accessChange.create({ data: { accountId: row.accountId, grantId: grant.id, actorId, operationId: command.operationId,
      kind: `enrollment_${command.action}`, reason: command.reason, recordedAt: now } });
    await tx.accessReceipt.create({ data: { scope: actorId, operationId: command.operationId, fingerprint,
      payload: { command, before, after: result.value }, result, createdAt: now } });
    return result;
  });
}
