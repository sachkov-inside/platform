import type { z } from "zod";
import { tributeStateSchema } from "../../domain/tribute-source.js";
import { enrollmentSourceState, enrollmentView } from "../../shared/enrollment-view.js";
import { lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import type { MembershipEntitlementsPrismaClient, MembershipEntitlementsPrisma } from "../../infrastructure/prisma.js";
import { accessFailure } from "../../domain/access-grant.js";
import { changeEnrollmentSchema, enrollmentResultSchema, type EnrollmentResult } from "../../domain/subscription-enrollment.js";
import { accessFingerprint, readAccessReceipt } from "../../shared/access-receipts.js";

export async function changeEnrollment(prisma: MembershipEntitlementsPrismaClient, actorId: string, input: unknown, now: Date): Promise<EnrollmentResult> {
  const parsed = changeEnrollmentSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  return prisma.$transaction(tx => changeEnrollmentInTransaction(tx, actorId, command, now));
}
export async function changeEnrollmentInTransaction(tx: MembershipEntitlementsPrisma, actorId: string, command: z.infer<typeof changeEnrollmentSchema>, now: Date): Promise<EnrollmentResult> {
  const fingerprint = accessFingerprint({ action: "changeEnrollment", command });
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
    if (row.origin === "tribute") {
      const source = await tx.sourceEntitlement.findFirst({ where: { enrollmentId: row.id, origin: "tribute" } });
      if (source?.tributeState != null) {
        const state = tributeStateSchema.parse(source.tributeState);
        const next = tributeStateSchema.parse({ ...state, startsAt: data.startsAt.toISOString(), endsAt: data.endsAt?.toISOString(),
          mode: data.endPolicy === "confirmed_external" ? "confirmed_period" : "temporary_membership",
          observation: command.action === "restore" ? "pending" : state.observation,
          lastEventAt: now.toISOString(), lastEventFingerprint: null });
        await tx.sourceEntitlement.update({ where: { id: source.id }, data: { revokedAt: data.revokedAt,
          tributeState: next, revision: { increment: 1 }, checkedAt: now, evidence: { method: "owner_enrollment_change", actorId, command } } });
        if (next.mode === "temporary_membership") {
          const observedUntil = next.observedUntil === null ? null : new Date(next.observedUntil);
          const fresh = next.observation === "member" && observedUntil !== null && observedUntil > now;
          await tx.accessGrant.updateMany({ where: { enrollmentId: row.id }, data: {
            revokedAt: data.revokedAt ?? (fresh ? null : now),
            validUntil: observedUntil !== null && data.endsAt !== null && observedUntil < data.endsAt ? observedUntil : data.endsAt,
          } });
        }
      }
    }
    const value = enrollmentView(updated, now);
    const sourceState = await enrollmentSourceState(tx, row.id, now);
    if (sourceState !== undefined && value.state !== "revoked") value.state = sourceState;
    const result = { ok: true as const, value };
    await tx.accessChange.create({ data: { accountId: row.accountId, grantId: grant.id, actorId, operationId: command.operationId,
      kind: `enrollment_${command.action}`, reason: command.reason, recordedAt: now } });
    await tx.accessReceipt.create({ data: { scope: actorId, operationId: command.operationId, fingerprint,
      payload: { command, before, after: result.value }, result, createdAt: now } });
    return result;
}
