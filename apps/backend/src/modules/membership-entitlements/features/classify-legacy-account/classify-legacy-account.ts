import { lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import {
  accessFailure,
  accessFailureSchema,
  classificationTermsAgree,
  classificationTermsShape,
} from "../../domain/access-grant.js";
import {
  accessFingerprint,
  readAccessReceipt,
} from "../../shared/access-receipts.js";
import {
  readClassificationRevision,
  writeClassification,
} from "../../shared/write-classification.js";
export const classifyLegacyAccountCommandSchema = z
  .object({
    operationId: z.uuid(),
    accountId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    ...classificationTermsShape,
  })
  .strict()
  .refine(classificationTermsAgree);
export type ClassifyLegacyAccountCommand = z.input<
  typeof classifyLegacyAccountCommandSchema
>;
const resultSchema = z.union([
  accessFailureSchema([
    "invalid_input",
    "not_found",
    "revision_conflict",
    "operation_conflict",
  ]),
  z.object({ ok: z.literal(true), revision: z.number().int().positive() }),
]);
export type ClassifyLegacyAccountResult = z.infer<typeof resultSchema>;

export async function classifyLegacyAccount(
  prisma: MembershipEntitlementsPrismaClient,
  accounts: Pick<Accounts, "readIdentityForLink">,
  actorId: string,
  input: ClassifyLegacyAccountCommand,
  now: Date,
): Promise<ClassifyLegacyAccountResult> {
  const parsed = classifyLegacyAccountCommandSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  if ((await accounts.readIdentityForLink(command.accountId)) === undefined)
    return accessFailure("not_found");
  const fingerprint = accessFingerprint({ kind: "classifyLegacy", ...command });
  return prisma.$transaction(async (transaction) => {
    const receipt = await readAccessReceipt(
      transaction,
      actorId,
      command.operationId,
    );
    if (receipt !== null)
      return receipt.fingerprint === fingerprint
        ? resultSchema.parse(receipt.result)
        : accessFailure("operation_conflict");
    await lockAccountEntitlementChanges(transaction, command.accountId);
    await lockAccess(transaction, `classification:${command.accountId}`);
    const revisionNow = await readClassificationRevision(
      transaction,
      command.accountId,
    );
    if (revisionNow !== command.expectedRevision)
      return accessFailure("revision_conflict");
    const revision = await writeClassification(transaction, {
      accountId: command.accountId,
      actorId,
      operationId: command.operationId,
      expectedRevision: command.expectedRevision,
      terms: command,
      now,
    });
    const result = { ok: true as const, revision };
    await transaction.accessReceipt.create({
      data: {
        scope: actorId,
        operationId: command.operationId,
        fingerprint,
        payload: command,
        result,
        createdAt: now,
      },
    });
    return result;
  });
}
