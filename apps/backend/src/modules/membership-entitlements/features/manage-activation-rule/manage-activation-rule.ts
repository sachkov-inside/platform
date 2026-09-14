import { accessFailure } from "../../domain/access-grant.js";
import { activationRuleSchema, manageActivationRuleSchema } from "../../domain/subscription-activation.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import { accessFingerprint, readAccessReceipt } from "../../shared/access-receipts.js";
export async function manageActivationRule(prisma: MembershipEntitlementsPrismaClient, actorId: string, input: unknown, now: Date) {
  const parsed = manageActivationRuleSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data; const fingerprint = accessFingerprint({ action: "manageActivationRule", command });
  return prisma.$transaction(async tx => {
    const receipt = await readAccessReceipt(tx, actorId, command.operationId);
    if (receipt !== null) return receipt.fingerprint === fingerprint ? { ok: true as const, value: activationRuleSchema.parse(receipt.result) } : accessFailure("operation_conflict");
    await lockAccess(tx, `activation-rule:${command.value.id}`);
    const current = await tx.activationRule.findUnique({ where: { id: command.value.id } });
    if (current?.revision !== command.expectedRevision) return accessFailure("revision_conflict");
    // Source identity is durable; editing a rule cannot reclassify a previously issued course.
    if (current !== null && (current.code !== command.value.code || current.sourceRef !== command.value.sourceRef || current.verificationMode !== (command.value.verificationMode ?? "course_membership"))) return accessFailure("invalid_input");
    if (command.value.verificationMode === "tribute_registry") {
      const policy = await tx.tributePolicy.findUnique({ where: { id: command.value.sourceRef } });
      if (policy === null || !policy.enabled) return accessFailure("invalid_input");
    }
    const data = { ...command.value, verificationMode: command.value.verificationMode ?? "course_membership", revision: (current?.revision ?? 0) + 1, startsAt: new Date(command.value.startsAt),
      endsAt: command.value.endsAt === null ? null : new Date(command.value.endsAt), reason: command.reason };
    await tx.activationRule.upsert({ where: { id: command.value.id }, create: data, update: data });
    const value = activationRuleSchema.parse({ ...command.value, revision: data.revision });
    await tx.accessReceipt.create({ data: { scope: actorId, operationId: command.operationId, fingerprint,
      payload: command, result: value, createdAt: now } });
    return { ok: true as const, value };
  });
}
