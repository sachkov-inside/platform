import { describe, expect, it } from "vitest";

import {
  checkoutButtonLabel,
  checkoutActionName,
  moscowDay,
  renewalTermsAtCheckout,
  renewalTermsLine,
  renewalTermsOnResume,
  resumeRenewalButtonLabel,
} from "@/entities/subscription";
import {
  canceledSubscription,
  guideQuote,
  savedQuote,
} from "@/workshop/billing.fixtures";

describe("acceptance by the payment button", () => {
  it("names the button the journal records for each sale", () => {
    expect(checkoutButtonLabel(guideQuote.snapshot)).toMatch(/^Оплатить \d/u);
    expect(checkoutActionName(guideQuote.snapshot)).toBe("Оплатить");
    expect(checkoutButtonLabel(savedQuote.snapshot)).toMatch(
      /^Оформить подписку и оплатить \d/u,
    );
    expect(checkoutActionName(savedQuote.snapshot)).toBe(
      "Оформить подписку и оплатить",
    );
    expect(resumeRenewalButtonLabel).toBe("Возобновить автопродление");
  });

  it("reads the day in the seller's calendar, not the browser's", () => {
    expect(moscowDay(new Date("2026-09-30T21:30:00.000Z"))).toBe("2026-10-01");
    expect(moscowDay(new Date("2026-09-30T20:59:00.000Z"))).toBe("2026-09-30");
  });

  it("shows the renewal amount, period and next day of a new subscription from its quote", () => {
    const terms = renewalTermsAtCheckout(savedQuote);
    expect(terms.amountKopecks).toBe(savedQuote.snapshot.renewalPriceKopecks);
    expect(terms.periodMonths).toBe(savedQuote.snapshot.paymentOption.months);
    expect(terms.nextChargeOn > moscowDay(new Date(savedQuote.createdAt))).toBe(
      true,
    );
  });

  it("continues a resumed subscription on the last day of its paid period", () => {
    expect(renewalTermsOnResume(canceledSubscription)).toEqual({
      amountKopecks: canceledSubscription.snapshot.renewalPriceKopecks,
      nextChargeOn: moscowDay(new Date(canceledSubscription.paidUntil)),
      periodMonths: canceledSubscription.snapshot.paymentOption.months,
    });
  });

  it("writes the terms as one line next to the button", () => {
    expect(
      renewalTermsLine({
        amountKopecks: 99_000,
        nextChargeOn: "2026-10-15",
        periodMonths: 1,
      }),
    ).toMatch(
      /^следующее списание 990\s₽ — 15 октября 2026 г\., затем раз в /u,
    );
  });
});
