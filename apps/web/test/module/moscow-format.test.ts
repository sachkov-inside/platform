import { describe, expect, it } from "vitest";

import {
  formatCountRu,
  formatMoscowDate,
  formatMoscowDateTime,
  formatMoscowShortDay,
  formatRubles,
  formatRublesInput,
  parseRublesInput,
  pluralRu,
} from "@/shared/lib/moscow-format";

const nbsp = " ";

/** Intl ставит неразрывные пробелы; сравнение по обычным держит ожидания читаемыми. */
function plain(text: string): string {
  return text.replace(/[  ]/gu, " ");
}

describe("Moscow dates", () => {
  it("shows an instant in Moscow time without the ISO form", () => {
    expect(plain(formatMoscowDateTime("2026-10-24T11:05:00Z"))).toBe(
      "24 окт. 2026, 14:05",
    );
    // «авг.» кончается на «г.»: убирается только «г.» после года.
    expect(plain(formatMoscowDateTime("2026-08-30T13:40:00Z"))).toBe(
      "30 авг. 2026, 16:40",
    );
    expect(plain(formatMoscowDate("2026-08-30"))).toBe("30 авг. 2026");
  });

  it("moves a late UTC evening to the next Moscow day", () => {
    expect(plain(formatMoscowDate("2026-10-24T22:30:00Z"))).toBe(
      "25 окт. 2026",
    );
    expect(formatMoscowShortDay("2026-10-24T22:30:00Z")).toBe("25 окт");
  });

  it("keeps a calendar day as that day", () => {
    expect(plain(formatMoscowDate("2026-10-10"))).toBe("10 окт. 2026");
    expect(formatMoscowShortDay("2026-10-10")).toBe("10 окт");
    expect(formatMoscowShortDay("2026-05-01")).toBe("1 мая");
  });
});

describe("rubles", () => {
  it("formats whole and fractional kopecks", () => {
    expect(formatRubles(499_000)).toBe(`4${nbsp}990${nbsp}₽`);
    expect(plain(formatRubles(123_450))).toBe("1 234,50 ₽");
    expect(plain(formatRubles(0))).toBe("0 ₽");
  });

  it("formats the field text without the currency sign", () => {
    expect(plain(formatRublesInput(499_000))).toBe("4 990");
    expect(plain(formatRublesInput(123_450))).toBe("1 234,50");
    expect(plain(formatRublesInput(5))).toBe("0,05");
  });

  it.each([
    ["4990", 499_000],
    ["4 990", 499_000],
    [`4${nbsp}990${nbsp}₽`, 499_000],
    ["4990 ₽", 499_000],
    ["4990₽", 499_000],
    ["4990 руб.", 499_000],
    ["1 234,50", 123_450],
    ["1234.5", 123_450],
    ["0,05", 5],
    ["  12  ", 1_200],
    ["0", 0],
  ])("reads «%s» as %i kopecks", (text, kopecks) => {
    expect(parseRublesInput(text)).toBe(kopecks);
  });

  it.each([
    "",
    "   ",
    "-100",
    "+100",
    "abc",
    "12,345",
    "1.2.3",
    "1,234.50",
    ",5",
    "5,",
    "1e3",
    "99999999999999999999",
  ])("rejects «%s»", (text) => {
    expect(parseRublesInput(text)).toBeNull();
  });

  it("round-trips the field text", () => {
    for (const kopecks of [0, 5, 99_900, 123_450, 10_000_000]) {
      expect(parseRublesInput(formatRublesInput(kopecks))).toBe(kopecks);
    }
  });
});

describe("Russian plurals", () => {
  const materials = ["материал", "материала", "материалов"] as const;

  it.each([
    [1, "материал"],
    [2, "материала"],
    [4, "материала"],
    [5, "материалов"],
    [11, "материалов"],
    [12, "материалов"],
    [14, "материалов"],
    [21, "материал"],
    [22, "материала"],
    [111, "материалов"],
    [0, "материалов"],
  ])("%i → %s", (count, word) => {
    expect(pluralRu(count, materials)).toBe(word);
  });

  it("puts the number before the word", () => {
    expect(formatCountRu(12, materials)).toBe("12 материалов");
    expect(plain(formatCountRu(1234, ["продажа", "продажи", "продаж"]))).toBe(
      "1 234 продажи",
    );
  });
});
