import { describe, expect, it } from "vitest";

import {
  accessComposition,
  attemptStateLabel,
  publicSubscriptionOffers,
  benefitLines,
  billingErrorMessage,
  capabilityLabel,
  formatBillingDate,
  formatKopecks,
  formatMonths,
  noticeLabel,
  offerCompositionLabel,
  promotionLabel,
  subscriptionStateLabel,
} from "@/entities/subscription";
import {
  productOnlyOffer,
  productWithSupportOffer,
  materialsOffer,
  supportOffer,
} from "@/storybook/billing.fixtures";

describe("суммы и сроки", () => {
  it("показывает копейки только когда они есть", () => {
    expect(formatKopecks(350_000).replace(/ /gu, " ")).toBe("3 500 ₽");
    expect(formatKopecks(350_050).replace(/ /gu, " ")).toBe("3 500,50 ₽");
    expect(formatKopecks(0).replace(/ /gu, " ")).toBe("0 ₽");
  });

  it("склоняет месяцы", () => {
    expect(formatMonths(1)).toBe("1 месяц");
    expect(formatMonths(3)).toBe("3 месяца");
    expect(formatMonths(11)).toBe("11 месяцев");
    expect(formatMonths(12)).toBe("12 месяцев");
    expect(formatMonths(21)).toBe("21 месяц");
  });

  it("датирует срок календарём продавца, а не часовым поясом браузера", () => {
    expect(formatBillingDate("2026-09-30T21:30:00.000Z")).toBe(
      "1 октября 2026 г.",
    );
  });
});

/** Право на руководство из витринной фикстуры: его сроки и разбирают проверки состава. */
const productBenefit = productOnlyOffer.offer.benefits[0];
if (productBenefit === undefined) throw new Error("Ожидалось право на продукт");

describe("состав доступа", () => {
  it("называет известные права и не выдумывает неизвестные", () => {
    expect(capabilityLabel("materials")).toBe(
      "Все опубликованные материалы и продукты",
    );
    expect(capabilityLabel("support")).toBe("Вопросы автору и эфиры");
    expect(
      capabilityLabel("product:00000000-0000-4000-8000-000000000f01"),
    ).toBe("Отдельный продукт");
  });

  it("наследует период подписки, а явный null не называет срок", () => {
    const lines = benefitLines({
      offer: supportOffer.offer,
      paymentOption: { ...supportOffer.paymentOption, months: 3 },
    });
    expect(lines.map((line) => line.term)).toEqual([
      "3 месяца",
      "3 месяца",
      null,
    ]);
  });

  it("называет отдельное право на продукт и не называет ему срок", () => {
    const [line] = benefitLines(productOnlyOffer);
    expect(line?.label).toBe("Отдельный продукт");
    expect(line?.term).toBeNull();
  });

  it("называет общий чат, который открывает сам купленный продукт", () => {
    expect(
      benefitLines(productWithSupportOffer).map((line) => [
        line.label,
        line.term,
      ]),
    ).toEqual([
      ["Отдельный продукт", null],
      ["Вопросы автору и эфиры", "3 месяца"],
      ["Общий чат", null],
    ]);
  });

  it("даёт выведенному чату срок самого долгого продукта предложения", () => {
    const lines = benefitLines({
      offer: {
        ...productOnlyOffer.offer,
        benefitPeriods: [{ capability: productBenefit, months: 6 }],
      },
      paymentOption: productOnlyOffer.paymentOption,
    });
    expect(lines.map((line) => line.term)).toEqual(["6 месяцев", "6 месяцев"]);
  });

  it("не удваивает объявленный чат и держит его дольше короткого срока состава", () => {
    const offer = {
      ...productOnlyOffer.offer,
      benefits: [productBenefit, "community" as const],
      benefitPeriods: [
        { capability: productBenefit, months: null },
        { capability: "community" as const, months: 3 },
      ],
    };
    expect(accessComposition(offer.benefits)).toEqual([
      productBenefit,
      "community",
    ]);
    // Сервер объединяет основания в пользу самого долгого срока; состав называет тот же срок.
    expect(
      benefitLines({
        offer,
        paymentOption: productOnlyOffer.paymentOption,
      }).map((line) => [line.label, line.term]),
    ).toEqual([
      ["Отдельный продукт", null],
      ["Общий чат", null],
    ]);
  });

  it("держит чат по самому долгому сроку, когда оба основания срочные", () => {
    const lines = benefitLines({
      offer: {
        ...productOnlyOffer.offer,
        benefits: [productBenefit, "community" as const],
        benefitPeriods: [
          { capability: productBenefit, months: 6 },
          { capability: "community" as const, months: 3 },
        ],
      },
      paymentOption: productOnlyOffer.paymentOption,
    });
    expect(lines.map((line) => [line.label, line.term])).toEqual([
      ["Отдельный продукт", "6 месяцев"],
      ["Общий чат", "6 месяцев"],
    ]);
  });

  it("не обещает чат там, где продукт не продаётся", () => {
    expect(accessComposition(materialsOffer.offer.benefits)).toEqual([
      "materials",
    ]);
    expect(benefitLines(materialsOffer).map((line) => line.label)).toEqual([
      "Все опубликованные материалы и продукты",
    ]);
  });

  it("разовая покупка открывает право без объявленного срока и без названного срока", () => {
    const [line] = benefitLines({
      offer: { ...productOnlyOffer.offer, benefitPeriods: [] },
      paymentOption: productOnlyOffer.paymentOption,
    });
    // Наследовать нечего: оплаченного периода у разовой покупки нет.
    expect(line?.term).toBeNull();
  });

  it("показывает скидку только когда она есть в снимке", () => {
    expect(promotionLabel(materialsOffer)).toBeUndefined();
    expect(promotionLabel(supportOffer)).toBe("Старт · −20%");
  });
});

describe("что можно продать публично", () => {
  it("оставляет только подписку на каталог", () => {
    expect(
      publicSubscriptionOffers([
        materialsOffer,
        supportOffer,
        productOnlyOffer,
      ]).map((snapshot) => snapshot.offer.name),
    ).toEqual([materialsOffer.offer.name, supportOffer.offer.name]);
  });

  it("не выводит вид тарифа из состава прав: подписка на продукт тоже подписка", () => {
    const productSubscription = {
      ...productOnlyOffer,
      paymentOption: {
        ...productOnlyOffer.paymentOption,
        mode: "subscription" as const,
      },
    };
    expect(publicSubscriptionOffers([productSubscription])).toEqual([
      productSubscription,
    ]);
  });
});

describe("состояния и ошибки", () => {
  it("отделяет отказ в праве от завершённой сессии", () => {
    expect(billingErrorMessage("forbidden")).toBe(
      "У вас нет права на это действие.",
    );
    expect(billingErrorMessage("unauthorized")).toBe(
      "Сессия завершилась. Войдите снова.",
    );
  });

  it("отделяет банковское состояние попытки от состояния подписки", () => {
    expect(attemptStateLabel("unknown")).toBe("Результат ещё неизвестен");
    expect(attemptStateLabel("confirmed")).toBe("Оплата подтверждена");
    expect(subscriptionStateLabel("canceled")).toBe("Продление отменено");
    expect(noticeLabel("payment_failed")).toBe("Списание не прошло");
  });

  it("объясняет ожидаемые исходы billing словами покупателя", () => {
    expect(billingErrorMessage("contact_required")).toContain("email");
    expect(billingErrorMessage("legacy_review_required")).toContain(
      "прежняя подписка",
    );
    expect(billingErrorMessage("payment_in_progress")).toContain(
      "новую покупку начинать не нужно",
    );
    // Незавершённая оплата бывает и у разовой покупки, поэтому ведём в «Покупки»,
    // где видны все платежи, а не только расписание подписки.
    expect(billingErrorMessage("payment_in_progress")).toContain(
      "раздел «Покупки»",
    );
    expect(billingErrorMessage("existing_access")).toContain("уже есть доступ");
    // Прежняя редакция не принимается: покупатель читает действующую и нажимает кнопку снова.
    expect(billingErrorMessage("document_changed")).toBe(
      "Условия покупки обновились. Прочитайте действующую редакцию и нажмите кнопку оплаты снова.",
    );
  });
});

describe("состав предложения", () => {
  it("называет продукт с сопровождением по-русски", () => {
    expect(offerCompositionLabel(productWithSupportOffer.offer)).toBe(
      "Продукт с сопровождением и общим чатом",
    );
  });

  it("одну часть называет ею самой", () => {
    expect(offerCompositionLabel(materialsOffer.offer)).toBe("Все материалы");
  });

  it("называет чат и тогда, когда его открывает сам продукт", () => {
    expect(offerCompositionLabel(productOnlyOffer.offer)).toBe(
      "Продукт с общим чатом",
    );
  });

  it("перечисление разделяет запятой, а союз ставит только перед последним", () => {
    expect(offerCompositionLabel(supportOffer.offer)).toBe(
      "Все материалы с сопровождением и общим чатом",
    );
  });

  it("удлиняет предлог перед стечением согласных", () => {
    const offer = {
      ...productWithSupportOffer.offer,
      benefits: [
        ...productWithSupportOffer.offer.benefits,
        "materials" as const,
      ],
    };
    expect(offerCompositionLabel(offer)).toBe(
      "Продукт со всеми материалами, сопровождением и общим чатом",
    );
  });

  it("без знакомого состава оставляет имя предложения", () => {
    const offer = { ...productOnlyOffer.offer, benefits: [] };
    expect(offerCompositionLabel(offer)).toBe(offer.name);
  });
});
