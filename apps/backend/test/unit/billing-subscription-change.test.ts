import { describe, expect, test } from "vitest";
import { subscriptionPeriodEnd } from "../../src/modules/billing/domain/subscription-period.js";
import { planSubscriptionChange, upgradeTopUpKopecks } from "../../src/modules/billing/domain/subscription-change.js";

const anchor = new Date("2030-01-31T10:00:00Z");

describe("календарный anchor продления", () => {
  test("Jan 31 переходит в конец февраля и снова в 31 марта от исходного anchor", () => {
    expect(subscriptionPeriodEnd(anchor, 1).toISOString()).toBe("2030-02-28T10:00:00.000Z");
    expect(subscriptionPeriodEnd(anchor, 2).toISOString()).toBe("2030-03-31T10:00:00.000Z");
    expect(subscriptionPeriodEnd(anchor, 3).toISOString()).toBe("2030-04-30T10:00:00.000Z");
  });

  test("продление от прежнего конца потеряло бы исходное число", () => {
    const shifted = subscriptionPeriodEnd(subscriptionPeriodEnd(anchor, 1), 1);
    expect(shifted.toISOString()).toBe("2030-03-28T10:00:00.000Z");
    expect(shifted.toISOString()).not.toBe(subscriptionPeriodEnd(anchor, 2).toISOString());
  });
});

describe("доплата за повышение варианта", () => {
  const periodStartsAt = new Date("2030-01-01T00:00:00Z");
  const paidUntil = new Date("2030-01-31T00:00:00Z");
  const middle = new Date("2030-01-16T00:00:00Z");

  test("оплаченные 1 000 ₽ и переход на 3 500 ₽ в середине срока дают 1 250 ₽", () => {
    expect(upgradeTopUpKopecks({ targetPriceKopecks: 350_000, paidPeriodKopecks: 100_000, periodStartsAt, paidUntil, now: middle })).toBe(125_000);
  });

  test("половина копейки округляется вверх один раз на итоговой доплате", () => {
    expect(upgradeTopUpKopecks({ targetPriceKopecks: 103, paidPeriodKopecks: 100, periodStartsAt, paidUntil, now: middle })).toBe(2);
    expect(upgradeTopUpKopecks({ targetPriceKopecks: 101, paidPeriodKopecks: 100, periodStartsAt, paidUntil, now: middle })).toBe(1);
  });

  test("начало и конец срока дают полную разницу и ноль", () => {
    expect(upgradeTopUpKopecks({ targetPriceKopecks: 350_000, paidPeriodKopecks: 100_000, periodStartsAt, paidUntil, now: periodStartsAt })).toBe(250_000);
    expect(upgradeTopUpKopecks({ targetPriceKopecks: 350_000, paidPeriodKopecks: 100_000, periodStartsAt, paidUntil, now: paidUntil })).toBe(0);
  });
});

describe("выбор между повышением и следующим периодом", () => {
  const period = { periodStartsAt: new Date("2030-01-01T00:00:00Z"), paidUntil: new Date("2030-01-31T00:00:00Z"), now: new Date("2030-01-16T00:00:00Z") };

  test("повышение при той же длительности сохраняет срок", () => {
    expect(planSubscriptionChange({ ...period, currentMonths: 1, targetMonths: 1, targetPriceKopecks: 350_000, paidPeriodKopecks: 100_000 }))
      .toEqual({ kind: "upgrade", topUpKopecks: 125_000 });
  });

  test("понижение и другая длительность переносятся на следующий период", () => {
    expect(planSubscriptionChange({ ...period, currentMonths: 1, targetMonths: 1, targetPriceKopecks: 90_000, paidPeriodKopecks: 100_000 })).toEqual({ kind: "scheduled" });
    expect(planSubscriptionChange({ ...period, currentMonths: 1, targetMonths: 12, targetPriceKopecks: 3_500_000, paidPeriodKopecks: 100_000 })).toEqual({ kind: "scheduled" });
  });

  test("нулевая доплата не становится бесплатным повышением", () => {
    expect(planSubscriptionChange({ ...period, currentMonths: 1, targetMonths: 1, targetPriceKopecks: 100_000, paidPeriodKopecks: 100_000 })).toEqual({ kind: "scheduled" });
  });
});
