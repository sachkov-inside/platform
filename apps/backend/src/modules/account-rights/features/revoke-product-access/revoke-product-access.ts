import {
  productAccessOriginSchema,
  readProductAccessOrigins,
} from "../../shared/product-access-origins.js";
import { randomUUID } from "node:crypto";
import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { productAccessViewSchema } from "../../domain/product-access.js";
import { productCapability } from "@inside/access-capabilities";
import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import { lockAccountEntitlementChanges } from "../../../../infrastructure/prisma/index.js";
import type {
  AccountRightsPrisma,
  AccountRightsPrismaClient,
} from "../../infrastructure/prisma.js";
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
        source: productAccessOriginSchema,
        capabilities: z.array(accessCapabilitySchema),
        validUntil: z.iso.datetime().nullable(),
      }),
    ),
  });
export const productAccessChangeResultSchema = z.strictObject({
  ok: z.literal(true),
  value: productAccessViewSchema,
});
export const productRevocationResultSchema = z.strictObject({
  ok: z.literal(true),
  value: productAccessViewSchema.extend({ access: z.literal("revoked") }),
});

export async function previewProductRevocation(
  prisma: AccountRightsPrismaClient,
  _accounts: Pick<Accounts, "readIdentityForLink">,
  input: unknown,
  _now: Date,
) {
  const parsed = productRevocationTargetSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const row = await prisma.productAccess.findUnique({
    where: { accountId_productId: parsed.data },
  });
  if (row === null) return accessFailure("not_found");
  const origins =
    row.revokedAt === null
      ? await readProductAccessOrigins(prisma, row.accountId, [row.productId])
      : undefined;
  return {
    ok: true as const,
    value: productRevocationPreviewSchema.parse({
      ...parsed.data,
      revision: row.revision,
      affectedCount: row.revokedAt === null ? 1 : 0,
      affected:
        row.revokedAt === null
          ? (origins?.get(row.productId) ?? ["unknown"]).map(
              (source: string) => ({
                source,
                capabilities: [productCapability(row.productId)],
                validUntil: null,
              }),
            )
          : [],
    }),
  };
}
export async function changeProductAccess(
  tx: AccountRightsPrisma,
  accounts: Pick<Accounts, "checkPermission">,
  actorId: string,
  input: unknown,
  now: Date,
  action: "revoke" | "restore",
) {
  const parsed = productRevocationCommandSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const decision = await accounts.checkPermission(
    { accountId: actorId, permission: "billing:manage" },
    transactionHandle(tx),
  );
  if (!decision.ok) return accessFailure("unavailable");
  if (!decision.allowed) return accessFailure("forbidden");
  const command = parsed.data;
  const target = { accountId: command.accountId, productId: command.productId };
  const fingerprint = accessFingerprint({
    kind: `${action}LifetimeProduct`,
    command,
  });
  const receipt = await readAccessReceipt(tx, actorId, command.operationId);
  if (receipt !== null)
    return fingerprint.recognizes(receipt.fingerprint)
      ? productAccessChangeResultSchema.parse(receipt.result)
      : accessFailure("operation_conflict");
  await lockAccountEntitlementChanges(tx, target.accountId);
  const row = await tx.productAccess.findUnique({
    where: { accountId_productId: target },
  });
  if (row === null) return accessFailure("not_found");
  if (row.revision !== command.expectedRevision)
    return accessFailure("revision_conflict");
  const revision = row.revision + 1;
  const updated = await tx.productAccess.update({
    where: { accountId_productId: target },
    data: { revision, revokedAt: action === "revoke" ? now : null },
  });
  await tx.productAccessAction.create({
    data: {
      id: randomUUID(),
      ...target,
      actorId,
      kind: action,
      reason: command.reason,
      recordedAt: now,
      revision,
    },
  });
  await tx.accessChange.create({
    data: {
      accountId: target.accountId,
      actorId,
      operationId: command.operationId,
      kind: `product_${action}`,
      reason: command.reason,
      recordedAt: now,
    },
  });
  const result = productAccessChangeResultSchema.parse({
    ok: true,
    value: {
      ...target,
      revision,
      firstIssuedAt: updated.firstIssuedAt?.toISOString() ?? null,
      access: updated.revokedAt === null ? "active" : "revoked",
    },
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
}
