import type { TelegramMembershipPrisma } from "../../../../infrastructure/prisma/index.js";

const deferredReceiptStatuses = ["registering", "unavailable", "expired"];

export function isDeferredTelegramSignInReceipt(link: {
  readonly status: string;
  readonly providerIdentityRef: string | null;
}): boolean {
  return (
    deferredReceiptStatuses.includes(link.status) &&
    link.providerIdentityRef !== null
  );
}

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
        status: { in: deferredReceiptStatuses },
        providerIdentityRef: { not: null },
      },
      orderBy: [{ createdAt: "asc" }, { linkRef: "asc" }],
    })
  );
}
