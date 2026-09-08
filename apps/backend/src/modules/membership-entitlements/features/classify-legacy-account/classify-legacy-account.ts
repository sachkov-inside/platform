import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { lockAccess } from "../../infrastructure/access-lock.js";
import {
  accessFailure,
  accessFailureSchema,
  classificationSchema,
  reasonSchema,
  sourceRefSchema,
} from "../../domain/access-grant.js";
import {
  accessFingerprint,
  readAccessReceipt,
} from "../../shared/access-receipts.js";
const commandSchema = z
  .object({
    operationId: z.uuid(),
    accountId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    classification: classificationSchema,
    sourceRef: sourceRefSchema,
    reason: reasonSchema,
    bridgeEnabled: z.boolean(),
    tributeStopped: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.classification === "confirmed_legacy" ||
      (!value.bridgeEnabled && !value.tributeStopped),
  );
export type ClassifyLegacyAccountCommand = z.input<typeof commandSchema>;
const resultSchema = z.union([
  accessFailureSchema,
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
  const parsed = commandSchema.safeParse(input);
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
    await lockAccess(transaction, `classification:${command.accountId}`);
    const existing = await transaction.legacyClassification.findUnique({
      where: { accountId: command.accountId },
    });
    if ((existing?.revision ?? 0) !== command.expectedRevision)
      return accessFailure("revision_conflict");
    const data = {
      classification: command.classification,
      sourceRef: command.sourceRef,
      reason: command.reason,
      verifiedAt: now,
      revision: command.expectedRevision + 1,
      bridgeEnabled: command.bridgeEnabled,
      tributeStopped: command.tributeStopped,
    };
    await transaction.legacyClassification.upsert({
      where: { accountId: command.accountId },
      create: { accountId: command.accountId, ...data },
      update: data,
    });
    const result = { ok: true as const, revision: data.revision };
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
        accountId: command.accountId,
        actorId,
        operationId: command.operationId,
        kind: "legacy_classified",
        reason: command.reason,
        recordedAt: now,
      },
    });
    return result;
  });
}
