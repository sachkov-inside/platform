import { describe, expect, it } from "vitest";

import type { PriceSnapshot } from "@/entities/subscription";
import { paymentLinkPricePreview } from "@/features/payment-links/model/payment-link-price";
import {
  paymentLinkExpiresAt,
  paymentLinkExpiryLabel,
} from "@/features/payment-links/model/payment-link-expiry";
import {
  parseSalesLinksQuery,
  salesLinksHref,
} from "@/_pages/sales-links/model/sales-links-query";

const productId = "00000000-0000-4000-8000-000000001801";
const snapshot: PriceSnapshot = {
  product: { id: productId, name: "AI Engineering", priceRevision: 3 },
  offer: {
    id: "00000000-0000-4000-8000-000000001802",
    revision: 1,
    name: "AI Engineering",
    benefits: [`product:${productId}`],
    archived: false,
  },
  paymentOption: {
    id: "00000000-0000-4000-8000-000000001803",
    revision: 1,
    offerId: "00000000-0000-4000-8000-000000001802",
    months: 12,
    priceKopecks: 2_990_000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 2_990_000,
  renewalPriceKopecks: 2_990_000,
};

describe("payment link price preview", () => {
  it("keeps the product price as a zero discount", () => {
    const preview = paymentLinkPricePreview(snapshot, { kind: "product" });
    expect(preview).toMatchObject({
      valid: true,
      price: { kind: "discount", percent: 0 },
    });
    expect(preview.preview.firstPriceKopecks).toBe(2_990_000);
  });

  it("takes a whole percent off the product price and rounds to the kopeck", () => {
    const preview = paymentLinkPricePreview(snapshot, {
      kind: "discount",
      percentText: "15",
    });
    expect(preview).toMatchObject({
      valid: true,
      price: { kind: "discount", percent: 15 },
    });
    expect(preview.preview.firstPriceKopecks).toBe(2_541_500);
    expect(
      paymentLinkPricePreview(
        {
          ...snapshot,
          paymentOption: { ...snapshot.paymentOption, priceKopecks: 99_999 },
        },
        { kind: "discount", percentText: "33" },
      ).preview.firstPriceKopecks,
    ).toBe(66_999);
  });

  it("sends an amount in kopecks within the command bounds", () => {
    expect(
      paymentLinkPricePreview(snapshot, {
        kind: "amount",
        amountKopecks: 1_990_050,
      }),
    ).toMatchObject({
      valid: true,
      price: { kind: "amount", amountKopecks: 1_990_050 },
      preview: { firstPriceKopecks: 1_990_050 },
    });
    for (const amountKopecks of [null, 99, 100_000_001])
      expect(
        paymentLinkPricePreview(snapshot, { kind: "amount", amountKopecks }),
      ).toMatchObject({ valid: false, preview: snapshot });
  });

  it("rejects a fractional, negative or too large discount and a price below one rouble", () => {
    for (const percentText of ["10,5", "-5", "100", "сто", ""])
      expect(
        paymentLinkPricePreview(snapshot, { kind: "discount", percentText }),
      ).toMatchObject({
        valid: false,
        error: "Скидка должна быть целым числом от 0 до 99 %",
        preview: { firstPriceKopecks: 2_990_000 },
      });
    expect(
      paymentLinkPricePreview(
        {
          ...snapshot,
          paymentOption: { ...snapshot.paymentOption, priceKopecks: 150 },
        },
        { kind: "discount", percentText: "50" },
      ),
    ).toMatchObject({
      valid: false,
      error: "Итоговая цена должна быть не меньше 1 ₽",
    });
  });
});

describe("payment link expiry", () => {
  // 22:30 UTC is already 1 November in Moscow.
  const clock = () => new Date("2026-10-31T22:30:00.000Z");

  it("ends after the chosen Moscow day and sends a Moscow offset", () => {
    expect(paymentLinkExpiresAt("2026-11-15", clock)).toEqual({
      ok: true,
      expiresAt: "2026-11-16T00:00:00+03:00",
    });
    expect(paymentLinkExpiresAt("2026-11-01", clock)).toEqual({
      ok: true,
      expiresAt: "2026-11-02T00:00:00+03:00",
    });
    expect(paymentLinkExpiresAt("", clock)).toEqual({
      ok: true,
      expiresAt: null,
    });
  });

  it("refuses a day that has already ended in Moscow", () => {
    expect(paymentLinkExpiresAt("2026-10-31", clock)).toEqual({
      ok: false,
      error: "Дата окончания не может быть в прошлом",
    });
  });

  it("shows a Moscow midnight as the last day and an older moment with its time", () => {
    expect(paymentLinkExpiryLabel("2026-11-16T00:00:00+03:00")).toBe(
      "по 15 нояб. 2026",
    );
    expect(paymentLinkExpiryLabel("2026-11-15T15:30:00.000Z")).toBe(
      "до 15 нояб. 2026, 18:30",
    );
    expect(paymentLinkExpiryLabel(null)).toBe("Без срока");
  });
});

describe("payment links address", () => {
  it("keeps product and state and drops foreign values", () => {
    const href = salesLinksHref({ productId, state: "active" });
    expect(href).toBe(
      `/authoring/sales/links?product=${productId}&state=active`,
    );
    expect(
      parseSalesLinksQuery(new URL(href, "https://inside.test").searchParams),
    ).toEqual({ productId, state: "active" });
    expect(
      parseSalesLinksQuery(new URLSearchParams("product=abc&state=lost")),
    ).toEqual({ productId: null, state: null });
    expect(salesLinksHref({ productId: null, state: null })).toBe(
      "/authoring/sales/links",
    );
  });
});
