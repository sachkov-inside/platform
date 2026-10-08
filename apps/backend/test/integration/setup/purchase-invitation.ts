import { randomUUID } from "node:crypto";
import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

/** Синтетическое погашенное приглашение — начальное основание покупателя подписки в проверках оплаты. */
export async function seedPurchaseInvitation(
  prisma: PlatformPrisma,
  accountId: string,
  offerId: string,
): Promise<void> {
  await prisma.invitation.create({
    data: {
      id: randomUUID(),
      code: randomUUID(),
      offerId,
      offerRevision: 1,
      mode: "purchase",
      issuedBy: accountId,
      issuedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2100-01-01T00:00:00Z"),
      claimedAt: new Date("2026-01-01T00:00:00Z"),
      claimedIdentityRef: accountId,
      claimedAccountId: accountId,
      redeemedAt: new Date("2026-01-01T00:00:00Z"),
      revision: 1,
    },
  });
}

/** Подготовка исходного покупателя подписки; разовой оплате приглашение не требуется. */
export async function seedOptionPurchaseInvitation(
  prisma: PlatformPrisma,
  accountId: string,
  paymentOptionId: string,
): Promise<void> {
  const option = await prisma.billingPaymentOption.findUnique({
    where: { id: paymentOptionId },
  });
  if (option?.mode !== "subscription") return;
  if (
    await prisma.invitation.findFirst({
      where: {
        claimedAccountId: accountId,
        offerId: option.offerId,
        redeemedAt: { not: null },
      },
    })
  )
    return;
  await seedPurchaseInvitation(prisma, accountId, option.offerId);
}

export async function prepareInvitedQuote<
  T extends { paymentOptionId: string },
>(prisma: PlatformPrisma, accountId: string, command: T): Promise<T> {
  await seedOptionPurchaseInvitation(
    prisma,
    accountId,
    command.paymentOptionId,
  );
  return command;
}
