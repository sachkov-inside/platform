import { describe, expect, it } from "vitest";

import type { ProductCohort, PriceSnapshot } from "@/entities/subscription";
import type { ProductAccess } from "@/features/library-discovery";
import {
  cohortCall,
  formatCohortDate,
} from "@/_pages/library-discovery/model/cohort-call";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const cohort: ProductCohort = {
  productId: "00000000-0000-4000-8000-000000000814",
  revision: 1,
  name: "Поток 1",
  stage: "preorder",
  startsOn: "2026-10-20",
  nextEvent: "",
  priceAfterStartKopecks: null,
};
const slug = "ai-engineering";
const call = (
  overrides: Partial<{
    cohort: ProductCohort | null;
    offer: PriceSnapshot | null;
    productAccess: ProductAccess;
    signedIn: boolean;
  }> = {},
) =>
  cohortCall({
    cohort,
    offer: productWithSupportOffer,
    productAccess: "closed",
    signedIn: true,
    slug,
    ...overrides,
  });

describe("first screen call of a product cohort", () => {
  it("keeps the programme button when the product has no cohort", () => {
    expect(call({ cohort: null })).toEqual({
      banner: null,
      action: {
        kind: "programme",
        href: "/products/ai-engineering/programme",
        label: "Открыть программу",
      },
      compactOnPhone: true,
    });
  });

  it("never takes money on the announcement", () => {
    const guest = call({
      cohort: { ...cohort, stage: "announcement" },
      signedIn: false,
    });
    expect(guest.banner?.text).toBe(
      "Старт 20 октября. Предзаказ откроется скоро",
    );
    expect(guest.action).toEqual({
      kind: "sign-in",
      returnTo: "/products/ai-engineering/programme",
      label: "Читать главу 1 бесплатно",
    });
    expect(
      call({ cohort: { ...cohort, stage: "announcement" } }).action.kind,
    ).toBe("programme");
  });

  it("asks to pre-order before the start and to pay with the price while running", () => {
    const price = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 0,
    }).format(productWithSupportOffer.firstPriceKopecks / 100);
    expect(call().action).toEqual({
      kind: "purchase",
      href: "/products/ai-engineering/buy",
      label: "Оформить предзаказ",
    });
    expect(call({ cohort: { ...cohort, stage: "running" } }).action).toEqual({
      kind: "purchase",
      href: "/products/ai-engineering/buy",
      label: `Оплатить ${price}`,
    });
    expect(call().banner?.text).toBe("Набор на первый поток. Старт 20 октября");
    expect(call({ cohort: { ...cohort, stage: "running" } }).banner?.text).toBe(
      "Стартовал 20 октября. Присоединиться можно в любой момент",
    );
  });

  it("compares the pre-order price with the price after the start only when it is higher", () => {
    const afterStart = productWithSupportOffer.firstPriceKopecks + 1_000_000;
    const higher = call({
      cohort: { ...cohort, priceAfterStartKopecks: afterStart },
    });
    expect(higher.banner?.detail).toMatch(/^До старта — .+ вместо .+\./u);
    const lower = call({
      cohort: { ...cohort, priceAfterStartKopecks: 100 },
    });
    expect(lower.banner?.detail).toMatch(/^Предзаказ до старта дешевле/u);
  });

  it("names the next event between cohorts", () => {
    const between = call({
      cohort: {
        ...cohort,
        stage: "between",
        startsOn: null,
        nextEvent: "эфир 15 декабря",
      },
    });
    expect(between.banner?.text).toBe(
      "Курс открыт. Следующий поток: эфир 15 декабря",
    );
    expect(between.action).toMatchObject({
      kind: "purchase",
      label: "Оплатить",
    });
    // Срок сопровождения — из предложения (в фикстуре 3 месяца), а не из текста оферты.
    expect(between.banner?.detail).toBe(
      "Проходи в своём темпе, автор сопровождает тебя 3 месяца после покупки",
    );
    expect(
      call({ cohort: { ...cohort, stage: "between" }, offer: null }).banner
        ?.detail,
    ).toBe("Проходи в своём темпе");
  });

  it("hides payment without a sale and from a person the product is open to", () => {
    expect(call({ offer: null }).action.kind).toBe("programme");
    expect(call({ productAccess: "unknown" }).action.kind).toBe("purchase");
    for (const stage of ["preorder", "running", "between"] as const)
      expect(
        call({ cohort: { ...cohort, stage }, productAccess: "open" }).action
          .kind,
      ).toBe("programme");
  });
});

describe("cohort start date", () => {
  it("is a calendar day, not shifted by the reader's time zone", () => {
    expect(formatCohortDate("2026-10-20")).toBe("20 октября");
    expect(formatCohortDate("2027-01-01")).toBe("1 января");
  });
});
