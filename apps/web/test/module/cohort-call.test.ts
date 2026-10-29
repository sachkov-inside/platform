import { describe, expect, it } from "vitest";

import type { ProductSalesState, PriceSnapshot } from "@/entities/subscription";
import type { ProductAccess } from "@/features/library-discovery";
import {
  cohortCall,
  formatCohortDate,
} from "@/_pages/library-discovery/model/cohort-call";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const cohort: ProductSalesState = {
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
    cohort: ProductSalesState | null;
    offer: PriceSnapshot | null;
    productAccess: ProductAccess;
    signedIn: boolean;
    continuationMaterialSlug: string | null;
    freeStart: boolean;
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
  it("opens the programme for a participant even during preorder or without a cohort", () => {
    for (const current of [cohort, null])
      expect(call({ cohort: current, productAccess: "open" })).toEqual({
        banner: null,
        action: {
          kind: "programme",
          href: "/products/ai-engineering/programme",
          label: "Открыть программу",
        },
      });
  });

  it("opens the programme for a continuing participant", () => {
    expect(
      call({ productAccess: "open", continuationMaterialSlug: "course-intro" }),
    ).toEqual({
      banner: null,
      action: {
        kind: "programme",
        href: "/products/ai-engineering/programme",
        label: "Продолжить обучение",
      },
    });
  });

  it("does not lead away to the programme when the product has no cohort", () => {
    expect(call({ cohort: null })).toEqual({ banner: null, action: null });
  });

  it("never takes money on the announcement", () => {
    const guest = call({
      cohort: { ...cohort, stage: "announcement" },
      signedIn: false,
    });
    expect(guest.banner).toBeNull();
    expect(guest.action).toEqual({
      kind: "programme",
      href: "/products/ai-engineering/programme",
      label: "Открыть программу",
    });
    expect(
      call({ cohort: { ...cohort, stage: "announcement" } }).action,
    ).toEqual(guest.action);
  });

  it("only announces enrolment on the first screen and leads to the ticket below (#1647)", () => {
    // Предзаказ и покупку оформляют в билете внизу страницы: первый экран сообщает о наборе.
    expect(call()).toEqual({
      banner: {
        kind: "live",
        text: "Идёт набор на первый поток",
        detail: "",
        href: "#enroll",
      },
      action: null,
    });
    // После старта и между потоками цены и кнопки оплаты на первом экране нет (решение владельца
    // 29.10.2026): метка набора ведёт к билету с ценой.
    for (const stage of ["running", "between"] as const)
      expect(call({ cohort: { ...cohort, stage } })).toEqual({
        banner: {
          kind: "live",
          text: "Идёт набор на курс",
          detail: "",
          href: "#enroll",
        },
        action: null,
      });
  });

  it("leads to the programme without a sale and opens it to a person the product is open to", () => {
    for (const stage of ["running", "between"] as const) {
      expect(call({ cohort: { ...cohort, stage }, offer: null })).toEqual({
        banner: null,
        action: {
          kind: "programme",
          href: "/products/ai-engineering/programme",
          label: "Открыть программу",
        },
      });
      expect(
        call({ cohort: { ...cohort, stage }, productAccess: "open" }).action
          ?.kind,
      ).toBe("programme");
    }
  });
});

describe("first screen of a course with free lessons (#1647)", () => {
  it("leaves the programme to the try-free call on the animation", () => {
    // Анимация уже зовёт «Попробовать бесплатно» в программу: вторая кнопка туда же лишняя.
    for (const current of [
      { ...cohort, stage: "announcement" as const },
      { ...cohort, stage: "running" as const },
      { ...cohort, stage: "between" as const },
    ])
      expect(
        call({ cohort: current, offer: null, freeStart: true }).action,
      ).toBeNull();
  });

  it("keeps the learner's own action", () => {
    expect(call({ productAccess: "open", freeStart: true }).action?.label).toBe(
      "Открыть программу",
    );
  });
});

describe("cohort start date", () => {
  it("is a calendar day, not shifted by the reader's time zone", () => {
    expect(formatCohortDate("2026-10-20")).toBe("20 октября");
    expect(formatCohortDate("2027-01-01")).toBe("1 января");
  });
});
