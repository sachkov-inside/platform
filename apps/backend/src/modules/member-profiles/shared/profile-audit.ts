import { randomUUID } from "node:crypto";

import type { AccountId } from "../../accounts/index.js";
import type { PublicProfileId } from "../domain/public-profile-id.js";
import type { MemberProfilePersistence } from "../infrastructure/prisma.js";

export type MemberProfileAuditEvent =
  | "profile_created"
  | "profile_updated"
  | "profile_disabled"
  | "profile_restored";

export async function appendMemberProfileAuditEvent(
  prisma: MemberProfilePersistence,
  event: MemberProfileAuditEvent,
  accountId: AccountId,
  publicProfileId: PublicProfileId,
): Promise<void> {
  await prisma.memberProfileAuditEvent.create({
    data: { id: randomUUID(), event, accountId, publicProfileId },
  });
}
