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
    expect(oneTimePurchaseTerms.edition).toBe(
      currentLegalEdition("purchase").version,
    );
  });

  it("repeat the calculation term, the refund window and the equal price split of the offer text", () => {
    const text = flat(currentLegalEdition("purchase").text);
    expect(oneTimePurchaseTerms).toMatchObject({
      unlimitedPartRefundMonths: 12,
      fullRefundDays: 7,
    });
    expect(text).toContain(
      `расчётного срока ${String(oneTimePurchaseTerms.unlimitedPartRefundMonths)} календарных месяцев с подтверждения оплаты`,
    );
    // Редакция 7 пишет эти 7 дней словом «семи».
    expect(text).toContain(
      "Если отказ направлен в течение семи календарных дней, не считая дня подтверждения оплаты",
    );
    expect(text).toContain(
      "Половина цены относится к части «материалы и сообщество продукта», половина к части «сопровождение автора», с суммой каждой части.",
    );
  });

  it("give the whole Product without an end date and three calendar months of support", () => {
    const text = flat(currentLegalEdition("purchase").text);

    expect(text).toContain(
      "Одна учётная запись получает один бессрочный доступ к одному продукту (Product Access)",
    );
    expect(text).toContain(
      "Обещание сопровождения действует три календарных месяца с подтверждения успешной оплаты.",
    );
    expect(text).toContain("Три календарных месяца не заменяются 90 днями.");
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
