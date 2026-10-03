import type { TelegramMembershipPrisma } from "../../../../infrastructure/prisma/index.js";

/** A verified provider receipt survives the bearer start-token lifetime and failed later attempts. */
export async function readConfirmedTelegramLink(
  prisma: TelegramMembershipPrisma,
  accountId: string,
) {
  return (
    (await prisma.telegramLinkTransaction.findFirst({
      where: { accountId, status: "linked" },
      orderBy: [{ updatedAt: "desc" }, { linkRef: "desc" }],
    })) ??
    prisma.telegramLinkTransaction.findFirst({
      where: {
        accountId,
        status: { in: ["registering", "unavailable"] },
        providerIdentityRef: { not: null },
      },
      orderBy: [{ createdAt: "asc" }, { linkRef: "asc" }],
    })
  );
}
