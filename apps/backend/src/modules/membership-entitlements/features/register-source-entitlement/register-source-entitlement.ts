import { sourceIdentityRef } from "../../domain/source-identity.js";
import { randomUUID } from "node:crypto";
import { registerSourceSchema, sourceEntitlementViewSchema } from "../../domain/subscription-activation.js";
import { accessFailure } from "../../domain/access-grant.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import { accessFingerprint, readAccessReceipt } from "../../shared/access-receipts.js";
export async function registerSourceEntitlement(prisma: MembershipEntitlementsPrismaClient, actorId: string, input: unknown, now: Date) {
  const parsed = registerSourceSchema.safeParse(input);
  if (!parsed.success || new Date(parsed.data.checkedAt) > now) return accessFailure("invalid_input");
  const command = parsed.data; const fingerprint = accessFingerprint(command);
  const sourceRef = sourceIdentityRef(command.origin, command.sourcePolicyRef, command.identityRef);
  return prisma.$transaction(async tx => {
    const receipt = await readAccessReceipt(tx, actorId, command.operationId);
    if (receipt !== null) return receipt.fingerprint === fingerprint ? { ok: true as const, value: sourceEntitlementViewSchema.parse(receipt.result) } : accessFailure("operation_conflict");
    await lockAccess(tx, `enrollment:${command.origin}:${sourceRef}`);
    const existing = await tx.sourceEntitlement.findUnique({ where: { origin_sourceRef: { origin: command.origin, sourceRef } } });
    const row = existing ?? await tx.sourceEntitlement.create({ data: { id: randomUUID(), origin: command.origin, sourceRef,
      sourcePolicyRef: command.sourcePolicyRef, identityRef: command.identityRef, revision: 1, evidence: command, checkedAt: new Date(command.checkedAt) } });
    const value = sourceEntitlementViewSchema.parse({ id: row.id, origin: row.origin, sourceRef: row.sourceRef,
      sourcePolicyRef: row.sourcePolicyRef, identityRef: row.identityRef, accountId: row.accountId, enrollmentId: row.enrollmentId,
      revision: row.revision, checkedAt: row.checkedAt.toISOString() });
    await tx.accessReceipt.create({ data: { scope: actorId, operationId: command.operationId, fingerprint, payload: command, result: value, createdAt: now } });
    return { ok: true as const, value };
  });
}
