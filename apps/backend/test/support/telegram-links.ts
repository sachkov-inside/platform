import { randomBytes, randomUUID } from "node:crypto";

import type { PlatformPrisma } from "../../src/infrastructure/prisma/index.js";
import type { TelegramLinks } from "../../src/modules/content-access/index.js";

/**
 * Every reader has a confirmed Telegram link, so free Product lessons open without a purchase
 * (#1825). For tests whose subject is reading itself rather than who may read.
 */
export const everyAccountLinked: TelegramLinks = {
  confirmedLinks: (accountIds) =>
    Promise.resolve({
      ok: true,
      links: new Map(accountIds.map((id) => [id, true])),
    }),
};

/** A fixed instant: only the ordering columns of the link record use it. */
const linkedAt = new Date("2026-10-29T10:00:00.000Z");

/**
 * Records a Telegram link for one Account: `linked` as a finished bot sign-in or linking leaves it,
 * `pending` as a started one. The database trigger projects it into the state Content Access reads.
 */
export async function linkTelegram(
  prisma: Pick<PlatformPrisma, "account" | "telegramLinkTransaction">,
  account: { readonly logtoSubject: string } | { readonly accountId: string },
  status: "linked" | "pending" = "linked",
): Promise<{ readonly accountId: string; readonly linkRef: string }> {
  const accountId =
    "accountId" in account
      ? account.accountId
      : (
          await prisma.account.findFirstOrThrow({
            where: { logtoSubject: account.logtoSubject },
            select: { id: true },
          })
        ).id;
  const linkRef = randomUUID();
  await prisma.telegramLinkTransaction.create({
    data: {
      linkRef,
      accountId,
      principalRef: randomUUID(),
      providerIdentityRef: `telegram-identity-${accountId}`,
      providerTransactionRef: randomUUID(),
      returnCorrelation: randomUUID(),
      tokenDigest: randomBytes(32).toString("base64url"),
      status,
      createdAt: linkedAt,
      updatedAt: linkedAt,
      expiresAt: new Date(linkedAt.getTime() + 60_000),
    },
  });
  return { accountId, linkRef };
}
