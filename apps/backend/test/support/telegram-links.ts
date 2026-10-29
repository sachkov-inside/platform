import { randomBytes, randomUUID } from "node:crypto";

import type { PlatformPrisma } from "../../src/infrastructure/prisma/index.js";
import type { TelegramLinks } from "../../src/modules/content-access/index.js";

/**
 * Every reader has a confirmed Telegram link, so free Product lessons open without a purchase
 * (#1825). For tests whose subject is reading itself rather than who may read.
 */
export const everyAccountLinked: TelegramLinks = {
  confirmedLinks: (accountIds) =>
    Promise.resolve(
      new Map<string, boolean>(accountIds.map((id) => [id, true])),
    ),
};

/**
 * Records a confirmed Telegram link for one Account, as a finished bot sign-in or linking does;
 * the database trigger projects it into the current link state that Content Access reads.
 */
export async function linkTelegram(
  prisma: Pick<PlatformPrisma, "account" | "telegramLinkTransaction">,
  account: { readonly logtoSubject: string } | { readonly accountId: string },
): Promise<string> {
  const accountId =
    "accountId" in account
      ? account.accountId
      : (
          await prisma.account.findFirstOrThrow({
            where: { logtoSubject: account.logtoSubject },
            select: { id: true },
          })
        ).id;
  // deterministic-test-allow wall-clock: only the link ordering columns use it.
  const now = new Date();
  await prisma.telegramLinkTransaction.create({
    data: {
      linkRef: randomUUID(),
      accountId,
      principalRef: randomUUID(),
      providerIdentityRef: `telegram-identity-${accountId}`,
      providerTransactionRef: randomUUID(),
      returnCorrelation: randomUUID(),
      tokenDigest: randomBytes(32).toString("base64url"),
      status: "linked",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    },
  });
  return accountId;
}
