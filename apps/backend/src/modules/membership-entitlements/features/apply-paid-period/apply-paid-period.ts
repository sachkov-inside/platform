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

const commandSchema = z
  .object({
    eventRef: z.uuid(),
    periodRef: sourceRefSchema,
    accountId: z.uuid(),
    revision: z.number().int().positive(),
    revoked: z.boolean(),
    terms: grantTermsSchema.refine((value) => value.validUntil !== null),
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
export type ApplyPaidPeriodCommand = z.input<typeof commandSchema>;

// Trusted billing projector only. No transport exposes this payment-proof boundary.
export async function applyPaidPeriod(
  prisma: MembershipEntitlementsPrismaClient,
  accounts: Pick<Accounts, "readIdentityForLink">,
  input: ApplyPaidPeriodCommand,
  now: Date,
): Promise<PaidPeriodResult> {
  const parsed = commandSchema.safeParse(input);
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
    const grantRef = existing?.id ?? randomUUID();
    const data = {
      accountId: command.accountId,
      source: "paid",
      sourceRef: command.periodRef,
      capabilities: command.terms.capabilities,
      startsAt: new Date(command.terms.startsAt),
      validUntil:
        command.terms.validUntil === null
          ? null
          : new Date(command.terms.validUntil),
      revokedAt: command.revoked ? now : null,
      revision: command.revision,
      reason: command.terms.reason,
    };
    await transaction.accessGrant.upsert({
      where: { id: grantRef },
      create: { id: grantRef, ...data },
      update: data,
    });
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
