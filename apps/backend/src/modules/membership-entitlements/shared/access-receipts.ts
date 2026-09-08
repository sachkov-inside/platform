import { createHash } from "node:crypto";
import type { MembershipEntitlementsPrisma } from "../infrastructure/prisma.js";
import { lockAccess } from "../infrastructure/access-lock.js";

export function accessFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function readAccessReceipt(
  prisma: MembershipEntitlementsPrisma,
  scope: string,
  operationId: string,
) {
  await lockAccess(prisma, `operation:${scope}:${operationId}`);
  return prisma.accessReceipt.findUnique({
    where: { scope_operationId: { scope, operationId } },
  });
}
