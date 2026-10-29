import { describe, expect, it } from "vitest";

import type { ProductSalesState } from "@/entities/subscription";
import { cohortStatus } from "@/_pages/library-discovery/model/cohort-status";
import { formatDaysUntilStart } from "@/entities/subscription";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const cohort: ProductSalesState = {
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
const today = "2026-10-09";

describe("cohort recruitment plaque in the course status block", () => {
  it("sells the pre-order with the price after the start struck through and the discount to it", () => {
    const status = cohortStatus({
      cohort,
      offer,
      productAccess: "closed",
      slug,
      today,
    });
    expect(status).toMatchObject({
      countdown: "до старта 31 день",
      title: "Набор на первый поток",
      text: "До старта курс стоит дешевле. Цена вырастет 9 ноября.",
      // 29 900 ₽ к 39 900 ₽ — 25,06 %, вниз до целого.
      discount: "−25\u00a0%",
      purchaseHref: "/products/ai-engineering/buy",
      programmeHref: "/products/ai-engineering/programme",
    });
    expect(status?.price?.startsOn).toBe("9 ноября");
    expect(status?.price?.daysLeft).toBe("до старта 31 день");
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

  it("announces without a purchase and steps aside when the product is open or nothing is set", () => {
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
      cohortStatus({ cohort, offer, productAccess: "open", slug }),
    ).toBeNull();
    expect(
      cohortStatus({ cohort: null, offer, productAccess: "closed", slug }),
    ).toBeNull();
  });

  it("sells access with the price once the cohort runs or between cohorts (#1647)", () => {
    const running = cohortStatus({
      cohort: { ...cohort, stage: "running" },
      offer,
      productAccess: "closed",
      slug,
      today,
    });
    expect(running).toMatchObject({
      kind: "access",
      countdown: "",
      title: "Присоединяйся к курсу",
      discount: null,
      purchaseHref: "/products/ai-engineering/buy",
    });
    expect(running?.price?.price).toMatch(/^29\s900\s₽$/u);
    expect(running?.price?.priceAfterStart).toBeNull();
    const between = cohortStatus({
      cohort: {
        ...cohort,
        stage: "between",
        startsOn: null,
        nextEvent: "весной",
      },
      offer,
      productAccess: "closed",
      slug,
    });
    expect(between).toMatchObject({
      kind: "access",
      purchaseHref: "/products/ai-engineering/buy",
    });
    expect(between?.text).toContain("Следующий поток: весной");
  });

  it("leaves a running cohort without a sale to the block text", () => {
    expect(
      cohortStatus({
        cohort: { ...cohort, stage: "running" },
        offer: null,
        productAccess: "closed",
        slug,
      }),
    ).toBeNull();
  });

  it("invites to try for free when the course has free lessons (#1647)", () => {
    expect(
      cohortStatus({
        cohort,
        offer,
        productAccess: "closed",
        slug,
        freeStart: true,
      })?.freeStart,
    ).toBe(true);
    expect(
      cohortStatus({ cohort, offer, productAccess: "closed", slug })?.freeStart,
    ).toBe(false);
    expect(
      cohortStatus({ cohort, offer, productAccess: "closed", slug, today })
        ?.kind,
    ).toBe("preorder");
  });

  it("keeps the programme button when nothing is for sale", () => {
    expect(
      cohortStatus({ cohort, offer: null, productAccess: "closed", slug })
        ?.purchaseHref,
    ).toBeNull();
  });
});

describe("days until the cohort start", () => {
  it("counts calendar days with the Russian plural and names the start day itself", () => {
    expect(formatDaysUntilStart("2026-11-09", "2026-10-09")).toBe(
      "до старта 31 день",
    );
    expect(formatDaysUntilStart("2026-11-09", "2026-11-07")).toBe(
      "до старта 2 дня",
    );
    expect(formatDaysUntilStart("2026-11-09", "2026-10-28")).toBe(
      "до старта 12 дней",
    );
    expect(formatDaysUntilStart("2026-11-09", "2026-11-09")).toBe(
      "старт сегодня",
    );
    expect(formatDaysUntilStart("2026-11-09", "2026-11-10")).toBe(
      "старт 9 ноября",
    );
  });
});
