import { describe, expect, it } from "vitest";

import { formatYears } from "@/entities/subscription";
import {
  oneTimePriceSharesLine,
  oneTimePurchaseInclusions,
  oneTimeTermsSummary,
} from "@/features/billing-checkout";
import {
  guideOnlyOffer,
  guideWithSupportOffer,
} from "@/workshop/billing.fixtures";

/** Intl ставит неразрывные пробелы: сравниваем с текстом таблицы обычными. */
function plain(text: string): string {
  return text.replace(/[  ]/gu, " ");
}

describe("условия разовой покупки до оплаты", () => {
  it("склоняет годы гарантированного срока", () => {
    expect(formatYears(1)).toBe("1 год");
    expect(formatYears(2)).toBe("2 года");
    expect(formatYears(5)).toBe("5 лет");
    expect(formatYears(11)).toBe("11 лет");
  });

  it("показывает доли цены поровну под ценой", () => {
    expect(plain(oneTimePriceSharesLine(250_000))).toBe(
      "Из них поровну: материалы и чат — 1 250 ₽, сопровождение — 1 250 ₽",
    );
  });

  it("сводит условия оферты теми словами, которые утвердил владелец", () => {
    // Текст — строка 11 таблицы раскрытия Workspace product/legal/purchase-v3-preparation.md.
    expect(oneTimeTermsSummary).toEqual([
      "Материалы и чат — 2 года гарантированно, дальше без гарантии срока.",
      "Сопровождение — 6 месяцев: ответы и помощь в общем чате. Личные встречи, гарантированный срок ответа и обязательная проверка кода не входят.",
      "Отказ до открытия доступа — полный возврат. Позже — за вычетом истекшего времени, но не меньше положенного по закону.",
      "После отказа доступ по этой покупке закрывается.",
      "Если с нашей стороны есть недостатки или нарушения, действуют правила закона. При наличии оснований возвращается вся сумма.",
    ]);
  });

  it("называет сроки составляющих из оферты, а не из отсутствия даты у права", () => {
    // У права на продукт даты нет, но договорный срок материалов и чата — 2 года (строка 7).
    expect(oneTimePurchaseInclusions(guideOnlyOffer)).toEqual([
      {
        kind: "composition",
        caption: "Состав",
        title: "Продукт с общим чатом",
        detail: guideOnlyOffer.offer.name,
      },
      {
        kind: "materials",
        caption: "Материалы и общий чат",
        title: "2 года гарантированно",
        detail: "дальше без гарантии срока",
      },
      { kind: "support", caption: "Сопровождение автора", title: "6 месяцев" },
    ]);
    expect(oneTimePurchaseInclusions(guideWithSupportOffer)[0]?.title).toBe(
      "Продукт с сопровождением и общим чатом",
    );
  });
});
