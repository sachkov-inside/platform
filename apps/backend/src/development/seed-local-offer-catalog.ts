import { randomUUID } from "node:crypto";
import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import { BillingPricing } from "../modules/billing/index.js";
/** Development-only Product price. Existing sales closure stays under its owner's control. */
export async function seedLocalOfferCatalog(
  prisma: PlatformPrisma,
  target: {
    readonly actor: string;
    readonly productId: string;
    readonly onSale?: boolean;
  },
): Promise<void> {
  const pricing = new BillingPricing({
    prisma,
    sale: { payments: true },
    accounts: {
      checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
    },
  });
  const current = await prisma.billingProductPrice.findUnique({
    where: { productId: target.productId },
  });
  const name = "Руководство «Создание Platform Inside»",
    priceKopecks = 3000;
  if (current?.archived) return;
  const published =
    target.onSale === false ? false : (current?.published ?? true);
  if (
    current?.name === name &&
    Number(current.priceKopecks) === priceKopecks &&
    current.published === published
  )
    return;
  const result = await pricing.manage(target.actor, {
    operation: "productPrices.save",
    operationId: randomUUID(),
    ...(current === null ? {} : { expectedRevision: current.revision }),
    value: { productId: target.productId, name, priceKopecks, published },
  });
  if (!result.ok)
    throw new Error(`Local Product price fixture failed: ${result.error.code}`);
}
