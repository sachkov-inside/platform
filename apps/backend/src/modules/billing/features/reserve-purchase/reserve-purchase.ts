import { z } from "zod";
import type { BillingPrisma, BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { failure, idSchema, moneySchema, priceSnapshotSchema, type PriceSnapshot, type PricingResult } from "../../domain/pricing.js";
import { lockPricing } from "../../infrastructure/postgres/catalog-lock.js";
import { selectPrice } from "../../shared/select-price.js";

const reserveSchema = z.strictObject({
  accountId: idSchema, purchaseRef: idSchema, quoteRef: idSchema,
  amountLimits: z.strictObject({ minimumKopecks: moneySchema, maximumKopecks: moneySchema })
    .refine((value) => value.minimumKopecks <= value.maximumKopecks).nullable(),
});
export type ReservePurchase = z.infer<typeof reserveSchema>;

// Internal new-subscription operation. The purchase orchestrator owns eligibility,
// legal/recurring consent, one active lifecycle, and the durable provider attempt (#407).
type ReservePurchaseResult = PricingResult<PriceSnapshot,
  "invalid_request" | "not_found" | "operation_conflict" | "reservation_conflict" | "quote_expired" | "quote_changed" | "unsupported_amount" | "dependency_unavailable"
>;

export async function reservePurchase(prisma: BillingPrismaClient, input: ReservePurchase, clock: () => Date): Promise<ReservePurchaseResult> {
  const parsed = reserveSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_request");
  const command = parsed.data;
  try {
    return await prisma.$transaction(async (tx): Promise<ReservePurchaseResult> => {
      return reservePurchaseInTransaction(tx, command, clock());
    });
  } catch { return failure("dependency_unavailable"); }
}

// Same billing-owned transaction as the durable purchase; never nests a transaction.
export async function reservePurchaseInTransaction(tx: BillingPrisma, command: ReservePurchase, now: Date): Promise<ReservePurchaseResult> {
      await lockPricing(tx);
      const existing = await tx.billingPromoReservation.findUnique({ where: { purchaseRef: command.purchaseRef } });
      if (existing) return existing.accountId === command.accountId && existing.quoteRef === command.quoteRef
        ? { ok: true, value: priceSnapshotSchema.parse(existing.snapshot) } : failure("operation_conflict");
      const quote = await tx.billingPriceQuote.findUnique({ where: { id: command.quoteRef } });
      if (!quote || quote.accountId !== command.accountId) return failure("not_found");
      if (await tx.billingPromoReservation.findFirst({ where: { OR: [
        { quoteRef: command.quoteRef }, { accountId: command.accountId, state: { in: ["reserved", "sent", "unknown"] } },
      ] } })) return failure("reservation_conflict");
      if (now >= quote.expiresAt) return failure("quote_expired");
      const snapshot = priceSnapshotSchema.parse(quote.snapshot);
      // Предложение могли выключить из продажи после выписки quote: заказ не подтверждается.
      if (snapshot.offer.published !== true) return failure("not_found");
      const current = await selectPrice(tx, snapshot.paymentOption.id, now, quote.promoCode ?? undefined);
      if (!current.ok || JSON.stringify(current.value) !== JSON.stringify(snapshot)) return failure("quote_changed");
      const limits = command.amountLimits;
      if (!limits || [snapshot.firstPriceKopecks, snapshot.renewalPriceKopecks].some((amount) => amount < limits.minimumKopecks || amount > limits.maximumKopecks)) return failure("unsupported_amount");
      await tx.billingPromoReservation.create({ data: {
        purchaseRef: command.purchaseRef, accountId: command.accountId, quoteRef: command.quoteRef,
        promotionId: snapshot.promotion?.id ?? null, state: "reserved", snapshot,
      } });
      return { ok: true, value: snapshot };
}
