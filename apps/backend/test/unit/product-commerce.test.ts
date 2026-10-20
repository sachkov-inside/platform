import { expect, test } from "vitest";
import { saleCapability } from "../../src/modules/billing/domain/sale-capability.js";
import { paymentAdmission } from "../../src/modules/billing/shared/payment-admission.js";
import { renewalTerminal } from "../../src/modules/billing/shared/renewal-schedule.js";

const terminal = {
  recurringCardConfirmed: true,
  cardOnlyHostedConfirmed: true,
};
const sale = saleCapability(terminal, true);

test("terminal confirmation cannot enable product subscriptions or recurring charges", () => {
  expect(sale).toEqual({ payments: true, subscriptions: false });
  expect(saleCapability(undefined, true).payments).toBe(false);
  expect(saleCapability(terminal, false).payments).toBe(false);
  expect(renewalTerminal(terminal, sale)).toBe("no_recurring");
  expect(renewalTerminal(undefined, sale)).toBe("no_terminal");
});

test.each([
  "storefront",
  "quote",
  "purchase",
  "resume",
  "change",
  "renewal",
] as const)(
  "subscription %s is unavailable even with a redeemed invitation and valid consent",
  (context) => {
    expect(
      paymentAdmission({
        context,
        snapshot: {
          offer: {
            id: "72000000-0000-4000-8000-000000000501",
            revision: 1,
            name: "Historical",
            benefits: ["materials"],
            archived: false,
            eligibility: "invitation_only",
          },
          paymentOption: {
            id: "72000000-0000-4000-8000-000000000511",
            revision: 1,
            offerId: "72000000-0000-4000-8000-000000000501",
            mode: "subscription",
            months: 1,
            priceKopecks: 1000,
            archived: false,
          },
          renewalPriceKopecks: 1000,
        },
        sale,
        grounds: {
          invitedOfferIds: ["72000000-0000-4000-8000-000000000501"],
          formerTributeSubscriber: true,
        },
        recurringAllowed: true,
        bindingAvailable: true,
      }),
    ).toEqual({ ok: false, error: { code: "method_unavailable" } });
  },
);
