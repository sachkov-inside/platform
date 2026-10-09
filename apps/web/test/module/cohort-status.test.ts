import { describe, expect, it } from "vitest";

import type { ProductCohort } from "@/entities/subscription";
import { cohortStatus } from "@/_pages/library-discovery/model/cohort-status";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const cohort: ProductCohort = {
  productId: "00000000-0000-4000-8000-000000000814",
  revision: 1,
  name: "Поток 1",
  stage: "preorder",
  startsOn: "2026-11-09",
  nextEvent: "",
  priceAfterStartKopecks: 3_990_000,
};
const offer = { ...productWithSupportOffer, firstPriceKopecks: 2_990_000 };
const slug = "ai-engineering";

describe("cohort recruitment plaque in the course status block", () => {
  it("sells the pre-order with the price after the start struck through and the discount to it", () => {
    const status = cohortStatus({
      cohort,
      offer,
      productAccess: "closed",
      slug,
    });
    expect(status).toMatchObject({
      label: "Поток 1 · старт 9 ноября",
      title: "Набор на первый поток",
      text: "До старта курс стоит дешевле. Цена вырастет 9 ноября.",
      // 29 900 ₽ к 39 900 ₽ — 25,06 %, вниз до целого.
      discount: "−25\u00a0%",
      purchaseHref: "/products/ai-engineering/buy",
      programmeHref: "/products/ai-engineering/programme",
    });
    expect(status?.price?.startsOn).toBe("9 ноября");
    expect(status?.price?.priceAfterStart).not.toBeNull();
  });

  it("does not strike through a price that is not higher", () => {
    const status = cohortStatus({
      cohort: { ...cohort, priceAfterStartKopecks: 100 },
      offer,
      productAccess: "closed",
      slug,
    });
    expect(status?.price?.priceAfterStart).toBeNull();
    expect(status?.discount).toBeNull();
  });

  it("announces without a purchase and steps aside once the cohort runs or the product is open", () => {
    const announcement = cohortStatus({
      cohort: { ...cohort, stage: "announcement" },
      offer,
      productAccess: "closed",
      slug,
    });
    expect(announcement?.purchaseHref).toBeNull();
    expect(announcement?.price).toBeNull();
    expect(announcement?.text).toBe(
      "Предзаказ откроется скоро. До старта курс будет стоить дешевле.",
    );
    expect(
      cohortStatus({
        cohort: { ...cohort, stage: "running" },
        offer,
        productAccess: "closed",
        slug,
      }),
    ).toBeNull();
    expect(
      cohortStatus({ cohort, offer, productAccess: "open", slug }),
    ).toBeNull();
    expect(
      cohortStatus({ cohort: null, offer, productAccess: "closed", slug }),
    ).toBeNull();
  });

  it("keeps the programme button when nothing is for sale", () => {
    expect(
      cohortStatus({ cohort, offer: null, productAccess: "closed", slug })
        ?.purchaseHref,
    ).toBeNull();
  });
});
