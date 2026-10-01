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
  guideOnlyOffer,
  guideWithSupportOffer,
} from "@/workshop/billing.fixtures";

/** Intl ставит неразрывные пробелы: сравниваем с текстом таблицы обычными. */
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/gu, " ");
}

const [guide] = guideWithSupportOffer.offer.benefits;
if (guide === undefined) throw new Error("Fixture offer without a product");

/** То же предложение с другими сроками: по ним и видно, что страница читает предложение. */
function withPeriods(
  benefits: PriceSnapshot["offer"]["benefits"],
  benefitPeriods: NonNullable<PriceSnapshot["offer"]["benefitPeriods"]>,
): PriceSnapshot {
  return {
    ...guideWithSupportOffer,
    offer: { ...guideWithSupportOffer.offer, benefits, benefitPeriods },
  };
}

/** Предложение курса: материалы и чат без срока, сопровождение 6 месяцев. */
const course = withPeriods(
  [guide, "support"],
  [
    { capability: guide, months: null },
    { capability: "support", months: 6 },
  ],
);
/** Предложение со сроком материалов: 2 года материалов и чата, сопровождение год. */
const fixedTerm = withPeriods(
  [guide, "support"],
  [
    { capability: guide, months: 24 },
    { capability: "support", months: 12 },
  ],
);

describe("условия разовой покупки до оплаты", () => {
  it("склоняет годы и называет целые годы годами", () => {
    expect(formatYears(1)).toBe("1 год");
    expect(formatYears(5)).toBe("5 лет");
    expect(formatTermMonths(24)).toBe("2 года");
    expect(formatTermMonths(18)).toBe("18 месяцев");
    expect(formatTermMonths(6)).toBe("6 месяцев");
  });

  it("показывает доли цены поровну под ценой", () => {
    expect(
      plain(oneTimePriceSharesLine(250_000, oneTimeOfferTerms(course)) ?? ""),
    ).toBe(
      "Из них поровну: материалы и чат — 1 250 ₽, сопровождение — 1 250 ₽",
    );
    // Без сопровождения вся цена — материалы и чат: делить нечего.
    expect(
      oneTimePriceSharesLine(250_000, oneTimeOfferTerms(guideOnlyOffer)),
    ).toBeNull();
  });

  it("берёт сроки составляющих из снимка предложения", () => {
    expect(oneTimeOfferTerms(course)).toEqual({
      materialsMonths: null,
      chatMonths: null,
      supportMonths: 6,
    });
    expect(oneTimeOfferTerms(fixedTerm)).toEqual({
      materialsMonths: 24,
      chatMonths: 24,
      supportMonths: 12,
    });
    // Предложение без сопровождения срок сопровождения не называет вовсе.
    expect(oneTimeOfferTerms(guideOnlyOffer)).toEqual({
      materialsMonths: null,
      chatMonths: null,
    });
  });

  it("даёт чату срок материалов, пока предложение не назвало ему свой", () => {
    const ownChatTerm = withPeriods(
      [guide, "community"],
      [
        { capability: guide, months: 24 },
        { capability: "community", months: 6 },
      ],
    );
    expect(oneTimeOfferTerms(ownChatTerm)).toEqual({
      materialsMonths: 24,
      chatMonths: 6,
    });
    expect(
      oneTimeOfferTerms(
        withPeriods([guide, "community"], [{ capability: guide, months: 24 }]),
      ),
    ).toEqual({ materialsMonths: 24, chatMonths: 24 });
  });

  it("сводит условия предложения курса: материалы и чат без срока", () => {
    expect(oneTimeTermsSummary(oneTimeOfferTerms(course))).toEqual([
      "Материалы и чат — без ограничения срока.",
      "Сопровождение — 6 месяцев: ответы и помощь в общем чате. Личные встречи, гарантированный срок ответа и обязательная проверка кода не входят.",
      "Отказ в первые 7 дней или до открытия доступа — полный возврат. Позже — за вычетом истекшего времени: сопровождение — из его срока, материалы и чат — из расчётного срока 12 месяцев, но не меньше положенного по закону.",
      "После отказа доступ по этой покупке закрывается.",
      "Если с нашей стороны есть недостатки или нарушения, действуют правила закона. При наличии оснований возвращается вся сумма.",
    ]);
  });

  it("сводит условия предложения с другими сроками его же сроками", () => {
    const [materials, support, refund] = oneTimeTermsSummary(
      oneTimeOfferTerms(fixedTerm),
    );
    expect(materials).toBe(
      "Материалы и чат — 2 года гарантированно, дальше без гарантии срока.",
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
        title: "Продукт с сопровождением и общим чатом",
        detail: course.offer.name,
      },
      {
        kind: "materials",
        caption: "Материалы и общий чат",
        title: "Без ограничения срока",
      },
      { kind: "support", caption: "Сопровождение автора", title: "6 месяцев" },
    ]);
    expect(oneTimePurchaseInclusions(fixedTerm).slice(1)).toEqual([
      {
        kind: "materials",
        caption: "Материалы и общий чат",
        title: "2 года гарантированно",
        detail: "дальше без гарантии срока",
      },
      { kind: "support", caption: "Сопровождение автора", title: "1 год" },
    ]);
    // Сопровождения в предложении нет — строки о нём в составе тоже нет.
    expect(
      oneTimePurchaseInclusions(guideOnlyOffer).map(({ kind }) => kind),
    ).toEqual(["composition", "materials"]);
  });

  it("показывает материалы и чат отдельно, когда их сроки разные", () => {
    const split = withPeriods(
      [guide, "community"],
      [
        { capability: guide, months: null },
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
        caption: "Общий чат",
        title: "1 год гарантированно",
        detail: "дальше без гарантии срока",
      },
    ]);
    expect(oneTimeTermsSummary(oneTimeOfferTerms(split)).slice(0, 2)).toEqual([
      "Материалы — без ограничения срока.",
      "Общий чат — 1 год гарантированно, дальше без гарантии срока.",
    ]);
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
