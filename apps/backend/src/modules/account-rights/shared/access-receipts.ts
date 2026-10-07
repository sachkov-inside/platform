import { preProductCommand } from "../../../infrastructure/contracts/pre-product-command.js";
import { createHash } from "node:crypto";
import {
  replayFingerprint,
  type ReplayFingerprint,
} from "../../../infrastructure/contracts/canonical-digest.js";
import { lockAccountAccess } from "../../../infrastructure/prisma/index.js";
import type { AccountRightsPrisma } from "../infrastructure/prisma.js";

/**
 * Receipts, previews and identity snapshots of access operations. Version 1 hashed the bare value
 * in key order; stored version 1 digests are still recognized.
 */
export function accessFingerprint(value: unknown): ReplayFingerprint {
  const persisted = preProductCommand(value);
  return replayFingerprint(
    { version: 2, value: persisted },
    createHash("sha256").update(JSON.stringify(persisted)).digest("hex"),
  );
}
export async function readAccessReceipt(
  prisma: Pick<AccountRightsPrisma, "$executeRaw" | "accessReceipt">,
  scope: string,
  operationId: string,
) {
  await lockAccountAccess(prisma, `operation:${scope}:${operationId}`);
  return prisma.accessReceipt.findUnique({
    where: { scope_operationId: { scope, operationId } },
  });
}
