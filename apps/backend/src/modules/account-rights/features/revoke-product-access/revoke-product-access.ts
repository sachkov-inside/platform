import { productCapability } from "@inside/access-capabilities";
import {
  coverageSchema,
  scopeIncludesProduct,
} from "@inside/access-capabilities";
import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import { lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import type {
  AccountRightsPrisma,
  AccountRightsPrismaClient,
} from "../../infrastructure/prisma.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-isolation.js";
import {
  accessCapabilitySchema,
  accessFailure,
  reasonSchema,
} from "../../domain/access-grant.js";
import {
  accessFingerprint,
  readAccessReceipt,
} from "../../shared/access-receipts.js";

export const productRevocationTargetSchema = z.strictObject({
  accountId: z.uuid(),
  productId: z.uuid(),
});
export const productRevocationCommandSchema =
  productRevocationTargetSchema.extend({
    operationId: z.uuid(),
    expectedRevision: z.int().nonnegative(),
    reason: reasonSchema,
  });
export const productRevocationPreviewSchema =
  productRevocationTargetSchema.extend({
    revision: z.int().nonnegative(),
    affectedCount: z.int().nonnegative(),
    affected: z.array(
      z.strictObject({
        source: z.enum(["paid", "manual", "legacy"]),
        capabilities: z.array(accessCapabilitySchema),
        validUntil: z.iso.datetime().nullable(),
      }),
    ),
  });
export const productRevocationResultSchema = z.strictObject({
  ok: z.literal(true),
  value: productRevocationTargetSchema.extend({
    revision: z.int().positive(),
    access: z.literal("revoked"),
  }),
});

async function facts(
  prisma: AccountRightsPrisma,
  target: z.infer<typeof productRevocationTargetSchema>,
  now: Date,
) {
  const grants = await prisma.accessGrant.findMany({
    where: {
      accountId: target.accountId,
      revokedAt: null,
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    take: 1001,
  });
  if (grants.length > 1000)
    throw new Error("Product access grant limit exceeded");
  const exclusion = await prisma.productAccessExclusion.findUnique({
    where: { accountId_productId: target },
  });
  const affected = grants.filter(
    (grant) =>
      exclusion?.grantIds.includes(grant.id) !== true &&
      (grant.capabilities.includes(productCapability(target.productId)) ||
        (grant.coverage !== null &&
          scopeIncludesProduct(
            coverageSchema.parse(grant.coverage),
            target.productId,
          ))),
  );
  const revision = await prisma.accessChange.findFirst({
    where: { accountId: target.accountId },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  const legacy = await prisma.legacyClassification.findUnique({
    where: { accountId: target.accountId },
  });
  return {
    affected,
    exclusion,
    revision: revision?.revision ?? 0,
    bridge: legacy?.bridgeEnabled === true,
  };
}

export async function previewProductRevocation(
  prisma: AccountRightsPrismaClient,
  accounts: Pick<Accounts, "readIdentityForLink">,
  input: unknown,
  now: Date,
) {
  const parsed = productRevocationTargetSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  if ((await accounts.readIdentityForLink(parsed.data.accountId)) === undefined)
    return accessFailure("not_found");
  return prisma.$transaction(async (tx) => {
    await setAccessSnapshotIsolation(tx);
    const current = await facts(tx, parsed.data, now);
    return {
      ok: true as const,
      value: productRevocationPreviewSchema.parse({
        ...parsed.data,
        revision: current.revision,
        affectedCount: current.affected.length,
        affected: current.affected.map((grant) => ({
          source: grant.source,
          capabilities: grant.capabilities,
          validUntil: grant.validUntil?.toISOString() ?? null,
        })),
      }),
    };
  });
}

/** Product exclusions do not mutate Billing-owned grants or erase financial and learning history. */
export async function revokeProductAccess(
  prisma: AccountRightsPrismaClient,
  accounts: Pick<Accounts, "readIdentityForLink">,
  actorId: string,
  input: unknown,
  now: Date,
) {
  const parsed = productRevocationCommandSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  if ((await accounts.readIdentityForLink(parsed.data.accountId)) === undefined)
    return accessFailure("not_found");
  const command = parsed.data;
  const target = { accountId: command.accountId, productId: command.productId };
  const fingerprint = accessFingerprint({ kind: "revokeProduct", command });
  return prisma.$transaction(async (tx) => {
    const receipt = await readAccessReceipt(tx, actorId, command.operationId);
    if (receipt !== null)
      return fingerprint.recognizes(receipt.fingerprint)
        ? productRevocationResultSchema.parse(receipt.result)
        : accessFailure("operation_conflict");
    await lockAccountEntitlementChanges(tx, target.accountId);
    const current = await facts(tx, target, now);
    if (current.revision !== command.expectedRevision)
      return accessFailure("revision_conflict");
    const data = {
      grantIds: [
        ...new Set([
          ...(current.exclusion?.grantIds ?? []),
          ...current.affected.map((grant) => grant.id),
        ]),
      ],
      bridge: current.bridge || current.exclusion?.bridge === true,
      actorId,
      reason: command.reason,
      revokedAt: now,
    };
    await tx.productAccessExclusion.upsert({
      where: { accountId_productId: target },
      create: { ...target, ...data },
      update: data,
    });
    const change = await tx.accessChange.create({
      data: {
        accountId: target.accountId,
        actorId,
        operationId: command.operationId,
        kind: "product_revoke",
        reason: command.reason,
        recordedAt: now,
      },
    });
    const result = productRevocationResultSchema.parse({
      ok: true,
      value: { ...target, revision: change.revision, access: "revoked" },
    });
    await tx.accessReceipt.create({
      data: {
        scope: actorId,
        operationId: command.operationId,
        fingerprint: fingerprint.digest,
        payload: command,
        result,
        createdAt: now,
      },
    });
    return result;
  });
}
