import { describe, expect, it } from "vitest";

import { productCohortSchema } from "@/entities/subscription/model/billing-contract";
import {
  kopecksToRublesText,
  parseRublesToKopecks,
  saveCohortInputSchema,
} from "@/features/billing-admin/model/admin-operations";

const productId = "00000000-0000-4000-8000-000000000814";
const cohort = {
  productId,
  revision: 1,
  name: "Поток 1",
  stage: "preorder",
  startsOn: "2026-10-20",
  nextEvent: "",
} as const;

describe("цена после старта потока", () => {
  it.each([
    ["39900", 3_990_000],
    ["39 900", 3_990_000],
    ["39 900", 3_990_000],
    ["39900,5", 3_990_050],
    ["39900.05", 3_990_005],
    ["", null],
    ["   ", null],
  ])("читает рубли «%s» из формы как копейки", (text, kopecks) => {
    expect(parseRublesToKopecks(text)).toEqual({ ok: true, kopecks });
  });

  it.each(["0", "-100", "39900,505", "39 900 ₽", "много", "1e5"])(
    "отвергает «%s»: команда принимает только положительные копейки",
    (text) => {
      expect(parseRublesToKopecks(text)).toEqual({ ok: false });
    },
  );

  it("возвращает в поле формы те же рубли, что сохранены", () => {
    expect(kopecksToRublesText(3_990_000)).toBe("39900");
    expect(kopecksToRublesText(3_990_005)).toBe("39900,05");
    expect(parseRublesToKopecks(kopecksToRublesText(3_990_050))).toEqual({
      ok: true,
      kopecks: 3_990_050,
    });
  });

  it("читает поток прежнего backend без поля как поток без цены после старта", () => {
    expect(productCohortSchema.parse(cohort).priceAfterStartKopecks).toBeNull();
    expect(
      productCohortSchema.parse({
        ...cohort,
        priceAfterStartKopecks: 3_990_000,
      }).priceAfterStartKopecks,
    ).toBe(3_990_000);
    expect(
      productCohortSchema.safeParse({ ...cohort, priceAfterStartKopecks: -1 })
        .success,
    ).toBe(false);
  });

  it("сохраняет поток только с явной ценой после старта или null", () => {
    const { revision: _revision, ...value } = cohort;
    const command = (priceAfterStartKopecks?: unknown) => ({
      operationId: "00000000-0000-4000-8000-0000000000a1",
      expectedRevision: 1,
      value:
        priceAfterStartKopecks === undefined
          ? value
          : { ...value, priceAfterStartKopecks },
    });
    expect(saveCohortInputSchema.safeParse(command(null)).success).toBe(true);
    expect(saveCohortInputSchema.safeParse(command(3_990_000)).success).toBe(
      true,
    );
    for (const invalid of [undefined, 0, -100, 399.5])
      expect(saveCohortInputSchema.safeParse(command(invalid)).success).toBe(
        false,
      );
  });
});
