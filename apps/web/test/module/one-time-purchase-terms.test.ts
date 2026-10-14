import { describe, expect, it } from "vitest";

import {
  formatTermMonths,
  formatYears,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  fillOneTimeTerms,
  oneTimeOfferTerms,
  oneTimePriceSharesLine,
  oneTimePurchaseInclusions,
  oneTimeTermsSummary,
} from "@/features/billing-checkout";
import {
  productOnlyOffer,
  productWithSupportOffer,
} from "@/storybook/billing.fixtures";

/** Intl ставит неразрывные пробелы: сравниваем с текстом таблицы обычными. */
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/gu, " ");
}

const [product] = productWithSupportOffer.offer.benefits;
if (product === undefined) throw new Error("Fixture offer without a product");

/** То же предложение с другими сроками: по ним и видно, что страница читает предложение. */
function withPeriods(
  benefits: PriceSnapshot["offer"]["benefits"],
  benefitPeriods: NonNullable<PriceSnapshot["offer"]["benefitPeriods"]>,
): PriceSnapshot {
  return {
    ...productWithSupportOffer,
    offer: { ...productWithSupportOffer.offer, benefits, benefitPeriods },
  };
}

/** Предложение курса: материалы и материалы без срока, сопровождение 6 месяцев. */
const course = withPeriods(
  [product, "support"],
  [
    { capability: product, months: null },
    { capability: "support", months: 6 },
  ],
);
/** Предложение со сроком материалов: 2 года материалов и чата, сопровождение год. */
const fixedTerm = withPeriods(
  [product, "support"],
  [
    { capability: product, months: 24 },
    { capability: "support", months: 12 },
  ],
);

describe("условия разовой покупки до оплаты", () => {
  it("does not promise community in terms of a Product-only purchase", () => {
    expect(oneTimeOfferTerms(productOnlyOffer).chatMonths).toBeUndefined();
    expect(
      oneTimePurchaseInclusions(productOnlyOffer).some((item) =>
        /сообщество|чат/u.test(item.caption),
      ),
    ).toBe(false);
  });

  it("склоняет годы и называет целые годы годами", () => {
    expect(formatYears(1)).toBe("1 год");
    expect(formatYears(5)).toBe("5 лет");
    expect(formatTermMonths(24)).toBe("2 года");
    expect(formatTermMonths(18)).toBe("18 месяцев");
    expect(formatTermMonths(6)).toBe("6 месяцев");
  });

  it("показывает доли цены поровну под ценой", () => {
    expect(
      plain(oneTimePriceSharesLine(250_000, oneTimeOfferTerms(course))),
    ).toBe("Из них поровну: материалы — 1 250 ₽, сопровождение — 1 250 ₽");
    // Без сопровождения вся цена — материалы и чат: делить нечего.
    expect(
      oneTimePriceSharesLine(250_000, oneTimeOfferTerms(productOnlyOffer)),
    ).toBe("Вся цена относится к материалам");
  });

  it("берёт сроки составляющих из снимка предложения", () => {
    expect(oneTimeOfferTerms(course)).toEqual({
      materialsMonths: null,
      chatMonths: undefined,
      supportMonths: 6,
    });
    expect(oneTimeOfferTerms(fixedTerm)).toEqual({
      materialsMonths: 24,
      chatMonths: undefined,
      supportMonths: 12,
    });
    // Предложение без сопровождения срок сопровождения не называет вовсе.
    expect(oneTimeOfferTerms(productOnlyOffer)).toEqual({
      materialsMonths: null,
      chatMonths: undefined,
    });
  });

  it("даёт чату срок материалов, пока предложение не назвало ему свой", () => {
    const ownChatTerm = withPeriods(
      [product, "community"],
      [
        { capability: product, months: 24 },
        { capability: "community", months: 6 },
      ],
    );
    expect(oneTimeOfferTerms(ownChatTerm)).toEqual({
      materialsMonths: 24,
      chatMonths: 6,
    });
    expect(
      oneTimeOfferTerms(
        withPeriods(
          [product, "community"],
          [{ capability: product, months: 24 }],
        ),
      ),
    ).toEqual({ materialsMonths: 24, chatMonths: null });
  });

  it("сводит условия предложения курса: материалы и материалы без срока", () => {
    expect(oneTimeTermsSummary(oneTimeOfferTerms(course))).toEqual([
      "Материалы — без ограничения срока.",
      "Сопровождение — 6 месяцев: ответы и помощь автора. Личные встречи, гарантированный срок ответа и обязательная проверка кода не входят.",
      "Отказ в первые 7 дней или до открытия доступа — полный возврат. Позже — за вычетом истекшего времени: сопровождение — из его срока, материалы — из расчётного срока 12 месяцев, но не меньше положенного по закону.",
      "После отказа доступ по этой покупке закрывается.",
      "Если с нашей стороны есть недостатки или нарушения, действуют правила закона. При наличии оснований возвращается вся сумма.",
    ]);
  });

  it("сводит условия предложения с другими сроками его же сроками", () => {
    const [materials, support, refund] = oneTimeTermsSummary(
      oneTimeOfferTerms(fixedTerm),
    );
    expect(materials).toBe(
      "Материалы — 2 года гарантированно, дальше без гарантии срока.",
    );
    expect(support).toContain("Сопровождение — 1 год:");
    expect(refund).toBe(
      "Отказ в первые 7 дней или до открытия доступа — полный возврат. Позже — за вычетом истекшего времени, но не меньше положенного по закону.",
    );
  });

  it("называет в составе покупки сроки предложения", () => {
    expect(oneTimePurchaseInclusions(course)).toEqual([
      {
        kind: "composition",
        caption: "Состав",
        title: "Продукт с сопровождением",
        detail: course.offer.name,
      },
      {
        kind: "materials",
        caption: "Материалы",
        title: "Без ограничения срока",
      },
      { kind: "support", caption: "Сопровождение автора", title: "6 месяцев" },
    ]);
    expect(oneTimePurchaseInclusions(fixedTerm).slice(1)).toEqual([
      {
        kind: "materials",
        caption: "Материалы",
        title: "2 года гарантированно",
        detail: "дальше без гарантии срока",
      },
      { kind: "support", caption: "Сопровождение автора", title: "1 год" },
    ]);
    // Сопровождения в предложении нет — строки о нём в составе тоже нет.
    expect(
      oneTimePurchaseInclusions(productOnlyOffer).map(({ kind }) => kind),
    ).toEqual(["composition", "materials"]);
  });

  it("показывает материалы и чат отдельно, когда их сроки разные", () => {
    const split = withPeriods(
      [product, "community"],
      [
        { capability: product, months: null },
        { capability: "community", months: 12 },
      ],
    );
    expect(oneTimePurchaseInclusions(split).slice(1)).toEqual([
      {
        kind: "materials",
        caption: "Материалы",
        title: "Без ограничения срока",
      },
      {
        kind: "chat",
        caption: "Сообщество продукта",
        title: "1 год гарантированно",
        detail: "дальше без гарантии срока",
      },
    ]);
    expect(oneTimeTermsSummary(oneTimeOfferTerms(split)).slice(0, 2)).toEqual([
      "Материалы — без ограничения срока.",
      "Сообщество продукта — 1 год гарантированно, дальше без гарантии срока.",
    ]);
    // Расчётный срок не короче срока другой составляющей, названного в месяцах.
    const longChat = oneTimeOfferTerms(
      withPeriods(
        [product, "community"],
        [
          { capability: product, months: null },
          { capability: "community", months: 24 },
        ],
      ),
    );
    expect(oneTimeTermsSummary(longChat)[2]).toContain(
      "из расчётного срока 24 месяца",
    );
  });

  it("подставляет в описание продукта сроки его предложения", () => {
    const text = "Доступ — {access_term}, помощь — {support_term}.";
    expect(fillOneTimeTerms(text, oneTimeOfferTerms(course))).toBe(
      "Доступ — без ограничения срока, помощь — 6 месяцев.",
    );
    expect(fillOneTimeTerms(text, oneTimeOfferTerms(fixedTerm))).toBe(
      "Доступ — 2 года, помощь — 1 год.",
    );
    // Продукт не продаётся: срок назвать нечем, и страница его не выдумывает.
    expect(fillOneTimeTerms(text, null)).toBe(
      "Доступ — по условиям предложения, помощь — по условиям предложения.",
    );
  });
});
