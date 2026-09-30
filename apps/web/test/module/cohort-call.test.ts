import { describe, expect, it } from "vitest";

import type { MaterialPreview } from "@/entities/material";
import type { GuideCohort, PriceSnapshot } from "@/entities/subscription";
import {
  cohortCall,
  formatCohortDate,
  productOwnership,
} from "@/_pages/library-discovery/model/cohort-call";
import { guideWithSupportOffer } from "@/workshop/billing.fixtures";

const cohort: GuideCohort = {
  guideId: "00000000-0000-4000-8000-000000000814",
  revision: 1,
  name: "Поток 1",
  stage: "preorder",
  startsOn: "2026-10-20",
  nextEvent: "",
};
const slug = "ai-engineering";
const call = (
  overrides: Partial<{
    cohort: GuideCohort | null;
    offer: PriceSnapshot | null;
    ownership: "holds" | "lacks" | "unknown";
    signedIn: boolean;
  }> = {},
) =>
  cohortCall({
    cohort,
    offer: guideWithSupportOffer,
    ownership: "lacks",
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

  it("asks for the price of the offer this person sees on preorder and running", () => {
    const price = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 0,
    }).format(guideWithSupportOffer.firstPriceKopecks / 100);
    for (const stage of ["preorder", "running"] as const) {
      expect(call({ cohort: { ...cohort, stage } }).action).toEqual({
        kind: "purchase",
        href: "/products/ai-engineering/buy",
        label: `Оплатить ${price}`,
      });
    }
    expect(call().banner?.text).toBe("Предзаказ открыт до 20 октября");
    expect(call({ cohort: { ...cohort, stage: "running" } }).banner?.text).toBe(
      "Стартовал 20 октября. Присоединиться можно в любой момент",
    );
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
  });

  it("hides payment without a sale and from a person who already holds the product", () => {
    expect(call({ offer: null }).action.kind).toBe("programme");
    expect(call({ ownership: "holds" }).action.kind).toBe("programme");
    expect(call({ ownership: "unknown" }).action.kind).toBe("purchase");
  });
});

describe("product ownership seen in the programme", () => {
  const item = (
    access: MaterialPreview["access"],
    availability: MaterialPreview["availability"],
  ) => ({ access, availability });

  it("reads paid lessons only", () => {
    expect(productOwnership([item("free", "available")])).toBe("unknown");
    expect(
      productOwnership([
        item("free", "available"),
        item("membership", "available"),
      ]),
    ).toBe("holds");
    expect(
      productOwnership([
        item("membership", "available"),
        item("membership", "locked"),
      ]),
    ).toBe("lacks");
  });
});

describe("cohort start date", () => {
  it("is a calendar day, not shifted by the reader's time zone", () => {
    expect(formatCohortDate("2026-10-20")).toBe("20 октября");
    expect(formatCohortDate("2027-01-01")).toBe("1 января");
  });
});
