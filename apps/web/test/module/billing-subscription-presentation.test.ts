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
  guideOnlyOffer,
  guideWithSupportOffer,
  materialsOffer,
  supportOffer,
} from "@/workshop/billing.fixtures";

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
const guideBenefit = guideOnlyOffer.offer.benefits[0];
if (guideBenefit === undefined) throw new Error("Ожидалось право на руководство");

describe("состав доступа", () => {
  it("называет известные права и не выдумывает неизвестные", () => {
    expect(capabilityLabel("materials")).toBe(
      "Все опубликованные материалы и руководства",
    );
    expect(capabilityLabel("support")).toBe("Вопросы автору и эфиры");
    expect(
      capabilityLabel("guide:00000000-0000-4000-8000-000000000f01"),
    ).toBe("Отдельное руководство");
  });

  it("наследует период подписки, а явный null делает право бессрочным", () => {
    const lines = benefitLines({
      offer: supportOffer.offer,
      paymentOption: { ...supportOffer.paymentOption, months: 3 },
    });
    expect(lines.map((line) => line.term)).toEqual([
      "3 месяца",
      "3 месяца",
      "бессрочно",
    ]);
  });

  it("называет отдельное право на руководство и сохраняет его бессрочный срок", () => {
    const [line] = benefitLines(guideOnlyOffer);
    expect(line?.label).toBe("Отдельное руководство");
    expect(line?.term).toBe("бессрочно");
  });

  it("называет общий чат, который открывает само купленное руководство", () => {
    expect(
      benefitLines(guideWithSupportOffer).map((line) => [line.label, line.term]),
    ).toEqual([
      ["Отдельное руководство", "бессрочно"],
      ["Вопросы автору и эфиры", "3 месяца"],
      ["Общий чат", "бессрочно"],
    ]);
  });

  it("даёт выведенному чату срок самого долгого руководства предложения", () => {
    const lines = benefitLines({
      offer: {
        ...guideOnlyOffer.offer,
        benefitPeriods: [{ capability: guideBenefit, months: 6 }],
      },
      paymentOption: guideOnlyOffer.paymentOption,
    });
    expect(lines.map((line) => line.term)).toEqual(["6 месяцев", "6 месяцев"]);
  });

  it("не удваивает объявленный чат и держит его дольше короткого срока состава", () => {
    const offer = {
      ...guideOnlyOffer.offer,
      benefits: [guideBenefit, "community" as const],
      benefitPeriods: [
        { capability: guideBenefit, months: null },
        { capability: "community" as const, months: 3 },
      ],
    };
    expect(accessComposition(offer.benefits)).toEqual([guideBenefit, "community"]);
    // Сервер объединяет основания в пользу самого долгого срока; состав называет тот же срок.
    expect(
      benefitLines({
        offer,
        paymentOption: guideOnlyOffer.paymentOption,
      }).map((line) => [line.label, line.term]),
    ).toEqual([
      ["Отдельное руководство", "бессрочно"],
      ["Общий чат", "бессрочно"],
    ]);
  });

  it("держит чат по самому долгому сроку, когда оба основания срочные", () => {
    const lines = benefitLines({
      offer: {
        ...guideOnlyOffer.offer,
        benefits: [guideBenefit, "community" as const],
        benefitPeriods: [
          { capability: guideBenefit, months: 6 },
          { capability: "community" as const, months: 3 },
        ],
      },
      paymentOption: guideOnlyOffer.paymentOption,
    });
    expect(lines.map((line) => [line.label, line.term])).toEqual([
      ["Отдельное руководство", "6 месяцев"],
      ["Общий чат", "6 месяцев"],
    ]);
  });

  it("не обещает чат там, где руководство не продаётся", () => {
    expect(accessComposition(materialsOffer.offer.benefits)).toEqual([
      "materials",
    ]);
    expect(benefitLines(materialsOffer).map((line) => line.label)).toEqual([
      "Все опубликованные материалы и руководства",
    ]);
  });

  it("разовая покупка открывает право без объявленного срока бессрочно", () => {
    const [line] = benefitLines({
      offer: { ...guideOnlyOffer.offer, benefitPeriods: [] },
      paymentOption: guideOnlyOffer.paymentOption,
    });
    // Наследовать нечего: оплаченного периода у разовой покупки нет.
    expect(line?.term).toBe("бессрочно");
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
        guideOnlyOffer,
      ]).map((snapshot) => snapshot.offer.name),
    ).toEqual([materialsOffer.offer.name, supportOffer.offer.name]);
  });

  it("не выводит снятые с продажи позиции", () => {
    expect(
      publicSubscriptionOffers([
        { ...materialsOffer, offer: { ...materialsOffer.offer, archived: true } },
        {
          ...supportOffer,
          paymentOption: { ...supportOffer.paymentOption, archived: true },
        },
      ]),
    ).toEqual([]);
  });
});

describe("состояния и ошибки", () => {
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
  });
});

describe("состав предложения", () => {
  it("называет руководство с сопровождением по-русски", () => {
    expect(offerCompositionLabel(guideWithSupportOffer.offer)).toBe(
      "Руководство с сопровождением и общим чатом",
    );
  });

  it("одну часть называет ею самой", () => {
    expect(offerCompositionLabel(materialsOffer.offer)).toBe("Все материалы");
  });

  it("называет чат и тогда, когда его открывает само руководство", () => {
    expect(offerCompositionLabel(guideOnlyOffer.offer)).toBe(
      "Руководство с общим чатом",
    );
  });

  it("перечисление разделяет запятой, а союз ставит только перед последним", () => {
    expect(offerCompositionLabel(supportOffer.offer)).toBe(
      "Все материалы с сопровождением и общим чатом",
    );
  });

  it("удлиняет предлог перед стечением согласных", () => {
    const offer = {
      ...guideWithSupportOffer.offer,
      benefits: [...guideWithSupportOffer.offer.benefits, "materials" as const],
    };
    expect(offerCompositionLabel(offer)).toBe(
      "Руководство со всеми материалами, сопровождением и общим чатом",
    );
  });

  it("без знакомого состава оставляет имя предложения", () => {
    const offer = { ...guideOnlyOffer.offer, benefits: [] };
    expect(offerCompositionLabel(offer)).toBe(offer.name);
  });
});
