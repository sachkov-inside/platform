import { z } from "zod";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import {
  accessFailure,
  grantResultSchema,
  instantSchema,
  reasonSchema,
  type GrantResult,
} from "../../domain/access-grant.js";
import {
  accessFingerprint,
  readAccessReceipt,
} from "../../shared/access-receipts.js";

const common = {
  operationId: z.uuid(),
  grantRef: z.uuid(),
  expectedRevision: z.number().int().positive(),
  reason: reasonSchema,
};
const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("extend"),
      validUntil: instantSchema.nullable(),
    })
    .strict(),
  z.object({ ...common, action: z.literal("revoke") }).strict(),
]);
export type ChangeAccessGrantCommand = z.input<typeof commandSchema>;
export async function changeAccessGrant(
  prisma: MembershipEntitlementsPrismaClient,
  actorId: string,
  input: ChangeAccessGrantCommand,
  now: Date,
): Promise<GrantResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  const fingerprint = accessFingerprint({ kind: "changeGrant", ...command });
  return prisma.$transaction(async (transaction) => {
    const receipt = await readAccessReceipt(
      transaction,
      actorId,
      command.operationId,
    );
    if (receipt !== null)
      return receipt.fingerprint === fingerprint
        ? grantResultSchema.parse(receipt.result)
        : accessFailure("operation_conflict");
    await lockAccess(transaction, `grant:${command.grantRef}`);
    const grant = await transaction.accessGrant.findUnique({
      where: { id: command.grantRef },
    });
    if (grant === null) return accessFailure("not_found");
    // Billing owns paid revisions. Refund access decisions use its projector.
    if (grant.source === "paid") return accessFailure("forbidden");
    if (grant.revision !== command.expectedRevision)
      return accessFailure("revision_conflict");
    if (grant.revokedAt !== null) return accessFailure("revision_conflict");
    if (
      command.action === "extend" &&
      (grant.validUntil === null ||
        (command.validUntil !== null &&
          new Date(command.validUntil) <= grant.validUntil))
    )
      return accessFailure("invalid_input");
    await transaction.accessGrant.update({
      where: { id: grant.id },
      data: {
        revision: { increment: 1 },
        reason: command.reason,
        ...(command.action === "revoke"
          ? { revokedAt: now }
          : {
              validUntil:
                command.validUntil === null
                  ? null
                  : new Date(command.validUntil),
            }),
      },
    });
    const result = {
      ok: true as const,
      grantRef: grant.id,
      revision: grant.revision + 1,
    };
    await transaction.accessReceipt.create({
      data: {
        scope: actorId,
        operationId: command.operationId,
        fingerprint,
        result,
        createdAt: now,
      },
    });
    await transaction.accessChange.create({
      data: {
        accountId: grant.accountId,
        grantId: grant.id,
        actorId,
        operationId: command.operationId,
        kind: command.action,
        reason: command.reason,
        recordedAt: now,
      },
    });
    return result;
  });
}
