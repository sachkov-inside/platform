import { describe, expect, it } from "vitest";

import { currentLegalEdition } from "./catalog.js";
import { oneTimePriceShares, oneTimePurchaseTerms } from "./purchase-terms.js";

/** Текст оферты переносится по строкам; условия сверяются с ним как с одной строкой. */
function flat(text: string): string {
  return text.replace(/\s+/gu, " ");
}

describe("one-time purchase terms shown before payment", () => {
  it("belong to the one-time offer edition in force", () => {
    // Новая редакция оферты не пройдёт, пока сроки и доли на оплате не сверены с её текстом.
    expect(oneTimePurchaseTerms.edition).toBe(currentLegalEdition("purchase").version);
  });

  it("repeat the terms and the equal price split of the offer text", () => {
    const text = flat(currentLegalEdition("purchase").text);

    expect(oneTimePurchaseTerms).toMatchObject({ materialsAndChatYears: 2, supportMonths: 6 });
    expect(text).toContain("на гарантированный срок 2 года");
    expect(text).toContain("**Сопровождение автора** действует 6 календарных месяцев");
    expect(text).toContain(
      "половина — часть «материалы и общий чат», половина — часть «сопровождение автора»",
    );
  });

  it("split an even price into two equal parts", () => {
    expect(oneTimePriceShares(3_000_000)).toEqual({
      materialsAndChatKopecks: 1_500_000,
      supportKopecks: 1_500_000,
    });
  });

  it("keep the odd kopeck in the slower-shrinking materials part and lose nothing", () => {
    expect(oneTimePriceShares(12_345)).toEqual({
      materialsAndChatKopecks: 6_173,
      supportKopecks: 6_172,
    });
  });

  it("refuse an amount that is not a whole non-negative number of kopecks", () => {
    expect(() => oneTimePriceShares(-1)).toThrow("whole non-negative");
    expect(() => oneTimePriceShares(10.5)).toThrow("whole non-negative");
  });
});
