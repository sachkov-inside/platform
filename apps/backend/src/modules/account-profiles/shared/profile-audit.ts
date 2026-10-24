import { randomUUID } from "node:crypto";

import type { AccountId } from "../../accounts/index.js";
import type { PublicProfileId } from "../domain/public-profile-id.js";
import type { AccountProfilePersistence } from "../infrastructure/prisma.js";

export type AccountProfileAuditEvent =
  | "profile_created"
  | "profile_updated"
  | "profile_disabled"
  | "profile_restored";

export async function appendAccountProfileAuditEvent(
  prisma: AccountProfilePersistence,
  event: AccountProfileAuditEvent,
  accountId: AccountId,
  publicProfileId: PublicProfileId,
): Promise<void> {
  await prisma.accountProfileAuditEvent.create({
    data: { id: randomUUID(), event, accountId, publicProfileId },
  });
}
