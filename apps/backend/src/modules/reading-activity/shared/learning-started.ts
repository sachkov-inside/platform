import { z } from "zod";
import type { ReadingActivityPrismaClient } from "../../../infrastructure/prisma/index.js";

export const MAX_RECENT_SERIES = 10;
export type LearningStartedRead = (
  account: string,
  productId: string,
) => Promise<boolean>;
const idSchema = z.uuid().toLowerCase();

/** Standalone continuation always reads the current Account/Product pair. */
export async function readLearningStarted(
  prisma: ReadingActivityPrismaClient,
  account: string,
  productId: string,
): Promise<boolean> {
  const row = await prisma.productLearningStarted.findUnique({
    where: { accountId_productId: { accountId: account, productId } },
  });
  return row !== null;
}

/** One Home operation shares only bounded onboarding display facts, never access decisions. */
export function createLearningStartedRead(
  prisma: ReadingActivityPrismaClient,
  account: string,
  productIds: readonly string[],
): LearningStartedRead {
  const scope = idSchema.parse(account);
  const candidates = new Set(productIds.map((id) => idSchema.parse(id)));
  if (candidates.size > MAX_RECENT_SERIES)
    throw new Error("Learning Home series bound exceeded");
  let started: Promise<ReadonlySet<string>> | undefined;
  return async (requestedAccount, productId) => {
    const product = idSchema.parse(productId);
    // A changed slug binding or another Account cannot inherit an absent/present cached fact.
    if (idSchema.parse(requestedAccount) !== scope || !candidates.has(product))
      return readLearningStarted(prisma, requestedAccount, productId);
    started ??= prisma.productLearningStarted
      .findMany({
        where: { accountId: scope, productId: { in: [...candidates] } },
        select: { productId: true },
      })
      .then(
        (rows) => new Set(rows.map((row) => idSchema.parse(row.productId))),
      );
    return (await started).has(product);
  };
}
