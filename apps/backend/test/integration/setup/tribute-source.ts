import { randomUUID } from "node:crypto";

import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

/**
 * Подтверждённый период Tribute, уже привязанный к Account, — основание «прежний подписчик
 * Tribute». Строка пишется напрямую: сценарию нужен только сам факт основания, а путь реестра
 * Tribute проверяют его собственные наборы. Период по умолчанию давно закончился.
 */
export async function bindConfirmedTributeSource(
  prisma: PlatformPrisma,
  accountId: string,
): Promise<{ readonly revoke: () => Promise<void> }> {
  const id = randomUUID();
  await prisma.sourceEntitlement.create({
    data: {
      id,
      origin: "tribute",
      sourceRef: randomUUID(),
      sourcePolicyRef: `tribute-policy-${accountId}`,
      identityRef: `tribute-identity-${accountId}`,
      accountId,
      revision: 1,
      evidence: {},
      checkedAt: new Date("2026-01-01T00:00:00Z"),
      tributeState: {
        subscriptionId: 775,
        telegramUserId: "775000",
        verificationRef: `tribute-verification-${accountId}`,
        mode: "confirmed_period",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2026-02-01T00:00:00.000Z",
        renewal: "stopped",
        tier: {
          id: randomUUID(),
          revision: 1,
          name: "Стартовый тариф",
          benefits: ["community", "materials", "support"],
          contentScope: { guideIds: [], materialIds: [], allGuides: true },
        },
        policyRevision: 1,
        observation: "pending",
        observedUntil: null,
        observationVersion: null,
        lastEventAt: null,
        lastEventFingerprint: null,
      },
    },
  });
  return {
    revoke: async () => {
      await prisma.sourceEntitlement.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
    },
  };
}
