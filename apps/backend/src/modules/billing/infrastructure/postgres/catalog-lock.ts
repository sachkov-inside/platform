import { Prisma, type BillingPrisma } from "../../../../infrastructure/prisma/index.js";

export async function lockPricing(transaction: BillingPrisma): Promise<void> {
  // Catalog edits and first-payment reservations share one short transaction lock.
  // There is no provider I/O while holding it.
  await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('billing:pricing', 0::bigint))`);
}

export async function lockSubscription(transaction: BillingPrisma, subscriptionRef: string): Promise<void> {
  // Worker dispatch, cancel, change and payment-method decisions serialize on one subscription.
  await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:subscription:${subscriptionRef}`}, 0::bigint))`);
}
