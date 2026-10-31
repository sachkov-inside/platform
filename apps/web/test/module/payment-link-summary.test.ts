import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PaymentLinkSummary } from "@/entities/subscription";
import { oneTimeOfferTerms } from "@/features/billing-checkout";
import { individualSnapshot } from "@/storybook/payment-links.fixtures";

it("leaves purchase terms to the offer link", () => {
  const html = renderToStaticMarkup(
    createElement(PaymentLinkSummary, {
      snapshot: individualSnapshot,
      title: "AI Engineering",
    }),
  );
  expect(html).toContain("Материалы без ограничения срока");
  expect(html).toContain('href="/legal/purchase"');
  expect(html).toContain("Все условия покупки в оферте");
  expect(html).not.toContain("Сопровождение");
  expect(html).not.toContain("Расчётный срок");
  expect(oneTimeOfferTerms(individualSnapshot).supportMonths).toBe(3);
});
