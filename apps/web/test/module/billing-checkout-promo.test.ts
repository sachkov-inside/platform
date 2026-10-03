import { expect, it } from "vitest";

import { promoCodeFromQuery } from "@/features/billing-checkout/model/checkout";

it("берёт промокод персональной ссылки без пробелов по краям и с исходным регистром", () => {
  expect(promoCodeFromQuery(" Survey-7f3a ")).toBe("Survey-7f3a");
});

it("не угадывает код из пустого, повторённого или слишком длинного параметра", () => {
  expect(promoCodeFromQuery(undefined)).toBeUndefined();
  expect(promoCodeFromQuery("   ")).toBeUndefined();
  expect(promoCodeFromQuery(["a", "b"])).toBeUndefined();
  expect(promoCodeFromQuery("x".repeat(101))).toBeUndefined();
});
