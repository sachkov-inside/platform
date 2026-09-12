import type { ClassificationTerms } from "../domain/access-grant.js";
import type { MembershipEntitlementsPrisma } from "../infrastructure/prisma.js";

/** Отсутствующая запись — это «неизвестно» с нулевой редакцией, а не ошибка чтения. */
export async function readClassificationRevision(
  transaction: MembershipEntitlementsPrisma,
  accountId: string,
): Promise<number> {
  const existing = await transaction.legacyClassification.findUnique({
    where: { accountId },
  });
  return existing?.revision ?? 0;
}

/**
 * Единственная запись классификации: состояние Account, его новая revision и запись изменения.
 * Одиночная операция и строка набора пишут одно и то же, каждая под своим receipt и замком.
 */
export async function writeClassification(
  transaction: MembershipEntitlementsPrisma,
  input: {
    readonly accountId: string;
    readonly actorId: string;
    readonly operationId: string;
    readonly expectedRevision: number;
    readonly terms: ClassificationTerms;
    readonly now: Date;
  },
): Promise<number> {
  const data = {
    classification: input.terms.classification,
    sourceRef: input.terms.sourceRef,
    reason: input.terms.reason,
    verifiedAt: input.now,
    revision: input.expectedRevision + 1,
    bridgeEnabled: input.terms.bridgeEnabled,
    tributeStopped: input.terms.tributeStopped,
  };
  await transaction.legacyClassification.upsert({
    where: { accountId: input.accountId },
    create: { accountId: input.accountId, ...data },
    update: data,
  });
  await transaction.accessChange.create({
    data: {
      accountId: input.accountId,
      actorId: input.actorId,
      operationId: input.operationId,
      kind: "legacy_classified",
      reason: input.terms.reason,
      recordedAt: input.now,
    },
  });
  return data.revision;
}
