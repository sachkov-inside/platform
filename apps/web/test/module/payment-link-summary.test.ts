import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PaymentLinkSummary } from "@/entities/subscription";
import { oneTimeOfferTerms } from "@/features/billing-checkout";
import { individualSnapshot } from "@/storybook/payment-links.fixtures";

it("keeps the legal support duration out of the payment page, including expanded terms", () => {
  const html = renderToStaticMarkup(
    createElement(PaymentLinkSummary, {
      snapshot: individualSnapshot,
      title: "AI Engineering",
    }),
  );
  expect(html).toContain("Сопровождение автора по условиям оферты.");
  expect(html).not.toMatch(
    /Сопровождение автора[^<]*(?:\d|месяц|год|без ограничения срока)/u,
  );
  expect(html).toContain("Материалы без ограничения срока");
  expect(html).toContain("Он не ограничивает срок доступа.");
  expect(oneTimeOfferTerms(individualSnapshot).supportMonths).toBe(3);
});
