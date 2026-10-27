import { expect, it } from "vitest";
import {
  checkoutButtonLabel,
  checkoutActionName,
  moscowDay,
} from "@/entities/subscription";
import { productQuote } from "@/storybook/billing.fixtures";
it("records the exact Product purchase button, without recurring authority", () => {
  expect(checkoutButtonLabel(productQuote.snapshot)).toMatch(/^Оплатить /u);
  expect(checkoutActionName(productQuote.snapshot)).toBe("Оплатить");
});
it("uses the seller calendar", () => {
  expect(moscowDay(new Date("2026-09-30T21:30:00Z"))).toBe("2026-10-01");
  expect(moscowDay(new Date("2026-09-30T20:59:00Z"))).toBe("2026-09-30");
});
