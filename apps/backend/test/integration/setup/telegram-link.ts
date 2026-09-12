import { createHash, randomUUID } from "node:crypto";

import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

/** Срок жизни начатой связи по протоколу связывания: пять минут на подтверждение. */
const LINK_LIFETIME_MS = 5 * 60_000;

/**
 * Подтверждённая связь Account с Telegram: одна строка со статусом `linked`. Проекция
 * сообщества читает связь только через `readBinding`, поэтому сценарию, которому нужен
 * получатель команды, достаточно её. Остального, что делает протокол связывания при входе,
 * — привязки принципала в membership — здесь нет, и на проекцию она не влияет.
 */
export async function linkTelegramAccount(
  prisma: PlatformPrisma,
  input: {
    readonly accountId: string;
    readonly identityRef: string;
    readonly now: Date;
  },
): Promise<string> {
  const principalRef = randomUUID();
  await prisma.telegramLinkTransaction.create({
    data: {
      accountId: input.accountId,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + LINK_LIFETIME_MS),
      linkRef: randomUUID(),
      principalRef,
      providerIdentityRef: input.identityRef,
      providerTransactionRef: randomUUID(),
      returnCorrelation: randomUUID(),
      status: "linked",
      tokenDigest: createHash("sha256").update(principalRef).digest("base64url"),
      updatedAt: input.now,
    },
  });
  return principalRef;
}
