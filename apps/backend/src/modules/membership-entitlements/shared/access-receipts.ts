import { createHash } from "node:crypto";
import { lockAccountAccess } from "../../../infrastructure/prisma/index.js";
import type { MembershipEntitlementsPrisma } from "../infrastructure/prisma.js";

export function accessFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function readAccessReceipt(
  prisma: MembershipEntitlementsPrisma,
  scope: string,
  operationId: string,
) {
  await lockAccountAccess(prisma, `operation:${scope}:${operationId}`);
  return prisma.accessReceipt.findUnique({
    where: { scope_operationId: { scope, operationId } },
  });
}
