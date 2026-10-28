import { describe, expect, it } from "vitest";

import {
  emptyPromotionForm,
  promotionCommand,
  promotionFormFromItem,
} from "@/features/promotions/model/promotion-form";
import type { PromotionListItem } from "@/features/promotions/model/promotion-operations";
import { promotionState } from "@/features/promotions/model/promotion-state";
import {
  promotionPeriodLabel,
  promotionScope,
  promotionUsageLabel,
} from "@/features/promotions/model/promotions-presentation";
import {
  parseSalesDiscountsQuery,
  salesDiscountsHref,
} from "@/_pages/sales-discounts/model/sales-discounts-query";

const promotionId = "00000000-0000-4000-8000-000000001811";
const firstProduct = "00000000-0000-4000-8000-000000001812";
const secondProduct = "00000000-0000-4000-8000-000000001813";

const item: PromotionListItem = {
  id: promotionId,
  revision: 4,
  name: "Осенняя скидка",
  percent: 20,
  code: "AUTUMN",
  // 1–30 November in Moscow.
  startsAt: "2026-10-31T21:00:00.000Z",
  endsAt: "2026-11-30T21:00:00.000Z",
  productIds: [firstProduct],
  usageLimit: 50,
  archived: false,
  usedCount: 12,
  questionnaire: false,
  legacy: false,
};

describe("promotion state", () => {
  const at = (iso: string) => new Date(iso);

  it("follows the half-open period in Moscow time", () => {
    expect(promotionState(item, at("2026-10-31T20:59:59.000Z"))).toBe(
      "scheduled",
    );
    expect(promotionState(item, at("2026-10-31T21:00:00.000Z"))).toBe("active");
    expect(promotionState(item, at("2026-11-30T20:59:59.000Z"))).toBe("active");
    expect(promotionState(item, at("2026-11-30T21:00:00.000Z"))).toBe("ended");
  });

  it("puts archive first, then end of period, then an exhausted limit", () => {
    const during = at("2026-11-10T12:00:00.000Z");
    expect(promotionState({ ...item, usedCount: 50 }, during)).toBe(
      "exhausted",
    );
    expect(
      promotionState({ ...item, usageLimit: null, usedCount: 900 }, during),
    ).toBe("active");
    expect(
      promotionState(
        { ...item, usedCount: 50 },
        at("2026-12-01T00:00:00.000Z"),
      ),
    ).toBe("ended");
    expect(promotionState({ ...item, archived: true }, during)).toBe(
      "archived",
    );
  });
});

describe("promotion form", () => {
  it("turns Moscow days into the period instants of the command", () => {
    const command = promotionCommand(
      {
        ...emptyPromotionForm([firstProduct]),
        name: "  Чёрная пятница ",
        percentText: "30",
        startDate: "2026-11-27",
        endDate: "2026-11-30",
      },
      promotionId,
    );
    expect(command).toEqual({
      ok: true,
      value: {
        id: promotionId,
        name: "Чёрная пятница",
        percent: 30,
        code: null,
        startsAt: "2026-11-27T00:00:00+03:00",
        endsAt: "2026-12-01T00:00:00+03:00",
        productIds: [firstProduct],
        usageLimit: null,
      },
    });
  });

  it("keeps an empty product selection as all products and removes repeats", () => {
    const base = {
      ...emptyPromotionForm(),
      name: "Для всех",
      percentText: "10",
      startDate: "2026-11-01",
      endDate: "2026-11-01",
    };
    expect(promotionCommand(base, promotionId)).toMatchObject({
      ok: true,
      value: { productIds: [] },
    });
    expect(
      promotionCommand(
        { ...base, productIds: [secondProduct, firstProduct, secondProduct] },
        promotionId,
      ),
    ).toMatchObject({
      ok: true,
      value: { productIds: [secondProduct, firstProduct] },
    });
  });

  it("edits with the list revision and keeps unchanged period instants", () => {
    const origin = {
      id: promotionId,
      revision: 4,
      startsAt: "2026-11-01T09:30:00.000Z",
      endsAt: item.endsAt,
    };
    const values = promotionFormFromItem({
      ...item,
      startsAt: origin.startsAt,
    });
    expect(values).toMatchObject({
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      percentText: "20",
      code: "AUTUMN",
      usageLimitText: "50",
      productIds: [firstProduct],
    });
    expect(promotionCommand(values, promotionId, origin)).toMatchObject({
      ok: true,
      expectedRevision: 4,
      value: { startsAt: origin.startsAt, endsAt: item.endsAt },
    });
    expect(
      promotionCommand(
        { ...values, endDate: "2026-12-05" },
        promotionId,
        origin,
      ),
    ).toMatchObject({
      ok: true,
      value: { startsAt: origin.startsAt, endsAt: "2026-12-06T00:00:00+03:00" },
    });
  });

  it("names every invalid field in owner words", () => {
    expect(
      promotionCommand(
        {
          ...emptyPromotionForm(),
          percentText: "0",
          startDate: "2026-11-10",
          endDate: "2026-11-01",
          usageLimitText: "1,5",
        },
        promotionId,
      ),
    ).toEqual({
      ok: false,
      errors: {
        name: "Введите название скидки",
        percent: "Скидка должна быть целым числом от 1 до 100 %",
        endDate: "Последний день не может быть раньше первого",
        usageLimit: "Лимит должен быть целым числом от 1 или пустым",
      },
    });
  });
});

describe("promotion presentation", () => {
  const names = new Map([[firstProduct, "AI Engineering"]]);

  it("reads an empty scope as all products but a legacy scope as neither", () => {
    expect(
      promotionScope({ productIds: [], legacy: false }, (id) => names.get(id)),
    ).toEqual({
      kind: "all",
    });
    expect(
      promotionScope({ productIds: [], legacy: true }, (id) => names.get(id)),
    ).toEqual({
      kind: "legacy",
    });
    expect(
      promotionScope(
        { productIds: [firstProduct, secondProduct], legacy: false },
        (id) => names.get(id),
      ),
    ).toEqual({
      kind: "products",
      names: ["AI Engineering", "Продукт без цены"],
    });
  });

  it("shows the inclusive Moscow period and usage against the limit", () => {
    expect(promotionPeriodLabel(item)).toBe("1 нояб. 2026 – 30 нояб. 2026");
    expect(promotionUsageLabel(item)).toBe("12 из 50");
    expect(promotionUsageLabel({ usedCount: 1200, usageLimit: null })).toBe(
      "1\u00a0200, без лимита",
    );
  });
});

describe("discounts address", () => {
  it("round-trips the view, product and archive", () => {
    const href = salesDiscountsHref({
      view: "promotions",
      productId: firstProduct,
      archived: true,
    });
    expect(href).toBe(
      `/authoring/sales/discounts?product=${firstProduct}&archived=1`,
    );
    expect(
      parseSalesDiscountsQuery(
        new URL(href, "https://inside.test").searchParams,
      ),
    ).toEqual({ view: "promotions", productId: firstProduct, archived: true });
    expect(
      salesDiscountsHref(
        parseSalesDiscountsQuery(
          new URLSearchParams(`view=questionnaire&product=${firstProduct}`),
        ),
      ),
    ).toBe("/authoring/sales/discounts?view=questionnaire");
  });
});
