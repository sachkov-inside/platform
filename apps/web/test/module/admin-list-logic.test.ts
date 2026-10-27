import { describe, expect, it } from "vitest";

import { amountError } from "@/shared/ui/admin/amount-validation";
import { niceScale, xLabelIndices } from "@/shared/ui/admin/trend-scale";

function plain(text: string | null): string | null {
  return text === null ? null : text.replace(/[  ]/gu, " ");
}

describe("amount field validation", () => {
  const bounds = { min: 100, max: 5_000_000, required: false };

  it("accepts an empty optional field and a sum inside the bounds", () => {
    expect(amountError("", bounds)).toBeNull();
    expect(amountError("4 990 ₽", bounds)).toBeNull();
  });

  it("asks for a sum when the field is required", () => {
    expect(amountError("  ", { ...bounds, required: true })).toBe(
      "Введите сумму",
    );
  });

  it("names the reason for unreadable text and for each bound", () => {
    expect(amountError("двадцать", bounds)).toBe(
      "Введите сумму числом, например 4 990 или 1 234,50",
    );
    expect(plain(amountError("0,5", bounds))).toBe(
      "Сумма не может быть меньше 1 ₽",
    );
    expect(plain(amountError("50 000,01", bounds))).toBe(
      "Сумма не может быть больше 50 000 ₽",
    );
  });
});

describe("trend chart scale", () => {
  it("rounds the top up to a readable number", () => {
    expect(niceScale(1_996_000, true)).toEqual({
      max: 2_000_000,
      ticks: [0, 1_000_000, 2_000_000],
    });
    expect(niceScale(37, true).max).toBe(50);
  });

  it("drops a fractional middle line for whole counts", () => {
    expect(niceScale(1, true)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(9, true)).toEqual({ max: 10, ticks: [0, 5, 10] });
    expect(niceScale(2, true)).toEqual({ max: 2, ticks: [0, 1, 2] });
  });

  it("keeps a positive top for an all-zero series", () => {
    expect(niceScale(0, true).max).toBe(1);
  });

  it("labels the first and last day and spreads the rest", () => {
    expect(xLabelIndices(0)).toEqual([]);
    expect(xLabelIndices(1)).toEqual([0]);
    expect(xLabelIndices(5)).toEqual([0, 1, 2, 3, 4]);
    expect(xLabelIndices(30)).toEqual([0, 5, 10, 15, 19, 24, 29]);
    expect(xLabelIndices(90).at(-1)).toBe(89);
  });
});
