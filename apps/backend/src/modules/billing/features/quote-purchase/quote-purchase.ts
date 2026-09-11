import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { failure, idSchema, revisionSchema, priceSnapshotSchema, type PricingResult } from "../../domain/pricing.js";
import { lockPricing } from "../../infrastructure/postgres/catalog-lock.js";
import { selectPrice } from "../../shared/select-price.js";

export const quotePurchaseSchema = z.strictObject({ operationId: idSchema, paymentOptionId: idSchema, optionRevision: revisionSchema, promoCode: z.string().trim().min(1).max(100).optional() });
export const priceQuoteSchema = z.strictObject({ quoteRef: idSchema, snapshot: priceSnapshotSchema, createdAt: z.iso.datetime(), expiresAt: z.iso.datetime() });
export type PriceQuote = z.infer<typeof priceQuoteSchema>;
const quoteValidityMinutes = 15;

type QuotePurchaseResult = PricingResult<PriceQuote,
  "invalid_request" | "not_found" | "unsupported_amount" | "operation_conflict" | "quote_changed" | "dependency_unavailable"
>;

export async function quotePurchase(prisma: BillingPrismaClient, accountId: string, input: unknown, clock: () => Date): Promise<QuotePurchaseResult> {
  const parsed = quotePurchaseSchema.safeParse(input);
  const identity = idSchema.safeParse(accountId);
  if (!parsed.success || !identity.success) return failure("invalid_request");
  try {
    return await prisma.$transaction(async (tx): Promise<QuotePurchaseResult> => {
      await lockPricing(tx);
      const command = parsed.data;
      const key = { accountId: identity.data, operationId: command.operationId };
      const fingerprint = JSON.stringify(command);
      const existing = await tx.billingPriceQuote.findUnique({ where: { accountId_operationId: key } });
      if (existing) return existing.fingerprint === fingerprint ? { ok: true, value: {
        quoteRef: existing.id, snapshot: priceSnapshotSchema.parse(existing.snapshot), createdAt: existing.createdAt.toISOString(), expiresAt: existing.expiresAt.toISOString(),
      } } : failure("operation_conflict");
      const now = clock();
      const price = await selectPrice(tx, command.paymentOptionId, now, command.promoCode);
      if (!price.ok) return price;
      // Выключенное из продажи предложение не продаётся, даже если клиент прислал его вариант вручную.
      if (price.value.offer.published !== true) return failure("not_found");
      if (price.value.paymentOption.revision !== command.optionRevision) return failure("quote_changed");
      const expiresAt = new Date(now.getTime() + quoteValidityMinutes * 60_000);
      const id = randomUUID();
      await tx.billingPriceQuote.create({ data: { ...key, id, fingerprint, snapshot: price.value, promoCode: command.promoCode ?? null, createdAt: now, expiresAt } });
      return { ok: true, value: { quoteRef: id, snapshot: price.value, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() } };
    });
  } catch { return failure("dependency_unavailable"); }
}
