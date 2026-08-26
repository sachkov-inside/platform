import { randomUUID } from "node:crypto";

import type { AccountsPrisma } from "../../../../infrastructure/prisma/index.js";
import type { AccountId } from "../../domain/account-identifiers.js";

export type AccountAuditEvent =
  | "account_created"
  | "duplicate_identity_rejected"
  | "owner_bootstrap_completed"
  | "permission_granted"
  | "permission_revoked";

export async function appendAccountAuditEvent(
  prisma: AccountsPrisma,
  event: AccountAuditEvent,
  accountId?: AccountId,
): Promise<void> {
  await prisma.accountAuditEvent.create({
    data: { id: randomUUID(), event, accountId: accountId ?? null },
  });
}
