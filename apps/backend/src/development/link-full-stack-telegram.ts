import { randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";

/**
 * Full-stack readers signed in through Telegram (#1825): each named Account receives one confirmed
 * link, as a finished bot sign-in leaves it, so free Product lessons open without a purchase.
 * Repeating the command keeps the existing link.
 */
async function main(): Promise<void> {
  const config = loadPlatformConfig();
  if (config.mode !== "development") {
    throw new Error("Full-stack Telegram links run only in development mode");
  }
  const subjects = z
    .array(z.string().min(1))
    .min(1)
    .parse(JSON.parse(process.env["FULLSTACK_TELEGRAM_LOGTO_SUBJECTS"] ?? ""));
  const prisma = createPrismaClient(config.database.url);
  try {
    for (const subject of subjects) {
      const account = await prisma.account.findUniqueOrThrow({
        where: {
          logtoIssuer_logtoSubject: {
            logtoIssuer: config.identity.issuer,
            logtoSubject: subject,
          },
        },
        select: { id: true },
      });
      const linked = await prisma.telegramLinkTransaction.findFirst({
        where: { accountId: account.id, status: "linked" },
        select: { linkRef: true },
      });
      if (linked !== null) continue;
      const now = new Date();
      await prisma.telegramLinkTransaction.create({
        data: {
          linkRef: randomUUID(),
          accountId: account.id,
          principalRef: randomUUID(),
          providerIdentityRef: `fullstack-telegram-${account.id}`,
          providerTransactionRef: randomUUID(),
          returnCorrelation: randomUUID(),
          tokenDigest: randomBytes(32).toString("base64url"),
          status: "linked",
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
