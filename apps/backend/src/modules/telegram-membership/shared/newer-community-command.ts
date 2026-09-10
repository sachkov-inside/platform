import type { TelegramMembershipPrisma } from "../../../infrastructure/prisma/index.js";

export interface CommunityCommandKey {
  readonly accountId: string;
  readonly accountRef: string;
  readonly entitlementRevision: number;
}

/**
 * A recipient's desired state is whatever the highest revision addressed to it says.
 * Delivery and authorization both refuse to act on anything older than that.
 */
export async function hasNewerCommand(
  prisma: TelegramMembershipPrisma,
  command: CommunityCommandKey,
): Promise<boolean> {
  const newer = await prisma.telegramCommunityOperation.count({
    where: {
      accountId: command.accountId,
      accountRef: command.accountRef,
      entitlementRevision: { gt: command.entitlementRevision },
    },
  });
  return newer > 0;
}
