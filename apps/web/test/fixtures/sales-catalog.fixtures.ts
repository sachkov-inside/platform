import {
  salesCatalogueScenario,
  salesProductFacts,
} from "../../../../scenarios/sales-catalogue.mjs";
import { productCapability } from "@inside/access-capabilities";

import type { PaymentLink, PriceSnapshot } from "@/entities/subscription";

/**
 * Данные каталога цен и ссылок на оплату для модульных проверок (#1718).
 * Данные детерминированы: без случайности и текущих часов, с русскими названиями реальной длины.
 */

const id = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;

interface StoryProduct {
  readonly id: string;
  readonly name: string;
  readonly priceKopecks: number;
}

export const storyProducts: readonly StoryProduct[] = salesProductFacts(
  "story",
).map((fact) => ({
  id: id("98000000", fact.index),
  name: fact.name,
  priceKopecks: fact.priceKopecks,
}));

function product(index: number): StoryProduct {
  const found = storyProducts[index];
  if (found === undefined)
    throw new Error(`Missing story product ${String(index)}`);
  return found;
}

export function storyPriceSnapshot(
  item: StoryProduct,
  firstPriceKopecks = item.priceKopecks,
  linkId?: string,
): PriceSnapshot {
  const offerId = item.id.replace(/^98/u, "99");
  return {
    product: {
      id: item.id,
      name: item.name,
      priceRevision: salesCatalogueScenario.storyPriceRevision,
    },
    offer: {
      id: offerId,
      revision: 1,
      name: item.name,
      benefits: [productCapability(item.id)],
      benefitPeriods: [
        { capability: productCapability(item.id), months: null },
      ],
      archived: false,
      published: true,
    },
    paymentOption: {
      id: offerId.replace(/^99/u, "9a"),
      revision: 1,
      offerId,
      mode: "one_time",
      months: 1,
      priceKopecks: item.priceKopecks,
      archived: false,
    },
    promotion: null,
    currency: "RUB",
    timezone: "Europe/Moscow",
    ...(linkId === undefined
      ? {}
      : {
          individualPayment: { linkId, basePriceKopecks: item.priceKopecks },
        }),
    firstPriceKopecks,
    renewalPriceKopecks: firstPriceKopecks,
  };
}

const linkStates = [
  "active",
  "paid",
  "pending",
  "revoked",
  "expired",
  "unknown",
  "changed",
] as const;

/** `count` ссылок от новых к старым: все состояния по очереди, разные продукты и сроки. */
export function storyPaymentLinks(count: number): readonly PaymentLink[] {
  return Array.from({ length: count }, (_, index) => {
    const linkId = id("98100000", index + 1);
    const item = product(index % 3);
    return {
      id: linkId,
      revision: 1,
      state: linkStates[index % linkStates.length] ?? "active",
      createdAt: new Date(
        Date.parse(salesCatalogueScenario.linkCreatedEpoch) -
          index * 5 * 3_600_000,
      ).toISOString(),
      expiresAt:
        index % 3 === 1
          ? null
          : new Date(Date.UTC(2026, 10, 15 + (index % 10), 21)).toISOString(),
      snapshot: storyPriceSnapshot(
        item,
        Math.round(item.priceKopecks * (index % 2 === 0 ? 0.85 : 1)),
        linkId,
      ),
    };
  });
}
