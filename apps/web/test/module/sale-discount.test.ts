import { describe, expect, it } from "vitest";

import { saleDiscount, type PriceSnapshot } from "@/entities/subscription";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const promotion = {
  id: "00000000-0000-4000-8000-000000000901",
  revision: 1,
  name: "Чёрная пятница",
  percent: 25,
  // Период полуоткрыт: скидка действует до конца 30 ноября по Москве.
  endsAt: "2026-11-30T21:00:00.000Z",
};
const offer = (value: PriceSnapshot["promotion"]): PriceSnapshot => ({
  ...productWithSupportOffer,
  promotion: value,
});

describe("the running discount a visitor sees", () => {
  it("names the percent, the Promotion and its last day by Moscow time", () => {
    expect(saleDiscount(offer(promotion))).toEqual({
      percent: "−25 %",
      amount: "25 %",
      name: "Чёрная пятница",
      until: "до 30 ноября",
    });
  });

  it("names the Moscow day even when the end falls on another UTC day", () => {
    // 23:00 UTC 30 ноября — уже 02:00 1 декабря по Москве: 1 декабря скидка ещё действует.
    // Ровно полночь по Москве не входит в период: последний день — предыдущий.
    expect(
      saleDiscount(offer({ ...promotion, endsAt: "2026-11-30T23:00:00Z" })),
    ).toMatchObject({ until: "до 1 декабря" });
    expect(
      saleDiscount(
        offer({ ...promotion, endsAt: "2026-12-01T00:00:00+03:00" }),
      ),
    ).toMatchObject({ until: "до 30 ноября" });
  });

  it("leaves the last day out when an older price does not carry the end", () => {
    const { endsAt: _endsAt, ...withoutEnd } = promotion;
    expect(saleDiscount(offer(withoutEnd))).toEqual({
      percent: "−25 %",
      amount: "25 %",
      name: "Чёрная пятница",
      until: null,
    });
  });

  it("shows nothing without a Promotion or without a price", () => {
    expect(saleDiscount(offer(null))).toBeNull();
    expect(saleDiscount(null)).toBeNull();
  });
});
