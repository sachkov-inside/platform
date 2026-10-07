import { expect, it } from "vitest";

import { initialPaymentOptionId } from "@/_pages/subscription/model/initial-selection";
import {
  productPurchaseHref,
  purchaseInvitation,
  subscriptionHrefFrom,
  subscriptionOfferParam,
  subscriptionRouteTarget,
} from "@/shared/routing/subscription-route";
import {
  billingOffers,
  materialsOffer,
  supportOffer,
} from "@/storybook/billing.fixtures";

it("сохраняет контекст страницы продукта и отбрасывает внешние адреса", () => {
  expect(subscriptionRouteTarget("/products/platform-inside")).toEqual({
    returnTo: "/payment/checkout?from=%2Fproducts%2Fplatform-inside",
    originHref: "/products/platform-inside",
  });
  // Прежние адреса продукта перенаправляются на `/products/`, поэтому возврат на них остаётся.
  expect(subscriptionRouteTarget("/products/platform-inside").originHref).toBe(
    "/products/platform-inside",
  );
  expect(subscriptionRouteTarget("/series/platform-inside").originHref).toBe(
    "/series/platform-inside",
  );
  expect(subscriptionRouteTarget(["/topics/platform"]).originHref).toBe(
    "/topics/platform",
  );
  expect(subscriptionRouteTarget(undefined)).toEqual({
    returnTo: "/payment/checkout",
  });
  expect(subscriptionRouteTarget("https://example.test/products/x")).toEqual({
    returnTo: "/payment/checkout",
  });
  expect(subscriptionRouteTarget("//example.test")).toEqual({
    returnTo: "/payment/checkout",
  });
  expect(subscriptionRouteTarget("/authoring/materials")).toEqual({
    returnTo: "/payment/checkout",
  });
});

it("строит ссылку витрины со страницы продукта", () => {
  expect(subscriptionHrefFrom("/products/platform-inside")).toBe(
    "/payment/checkout?from=%2Fproducts%2Fplatform-inside",
  );
  expect(subscriptionHrefFrom("https://example.test")).toBe(
    "/payment/checkout",
  );
});

it("ведёт призыв к покупке внутрь платформы и молчит, когда покупать нечего", () => {
  // Своя цена руководства важнее тарифов: человек уже выбрал, что берёт.
  expect(
    purchaseInvitation({
      product: { slug: "platform-inside", sold: true },
      subscriptionOffered: true,
      from: "/materials/developer-pipeline",
    }),
  ).toEqual({ kind: "product", href: "/products/platform-inside/buy" });
  // Без своей цены остаётся витрина, и она помнит, откуда пришёл человек.
  expect(
    purchaseInvitation({
      product: { slug: "platform-inside", sold: false },
      subscriptionOffered: true,
      from: "/materials/developer-pipeline",
    }),
  ).toEqual({
    kind: "subscription",
    href: "/payment/checkout?from=%2Fmaterials%2Fdeveloper-pipeline",
  });
  expect(purchaseInvitation({ subscriptionOffered: true })).toEqual({
    kind: "subscription",
    href: "/payment/checkout",
  });
  // Выключенная продажа не зовёт никуда, даже когда человек стоит в руководстве.
  expect(
    purchaseInvitation({
      product: { slug: "platform-inside", sold: false },
      subscriptionOffered: false,
      from: "/products/platform-inside/programme",
    }),
  ).toBeNull();
  expect(purchaseInvitation({ subscriptionOffered: false })).toBeNull();
});

it("персональная ссылка оплаты несёт промокод и переживает вход", () => {
  expect(productPurchaseHref("platform-inside")).toBe(
    "/products/platform-inside/buy",
  );
  expect(productPurchaseHref("platform-inside", "Survey 7&x")).toBe(
    "/products/platform-inside/buy?promo=Survey+7%26x",
  );
});

it("принимает предложение из адреса бота одной строкой uuid и сохраняет его после входа", () => {
  const offerId = "00000000-0000-4000-8000-000000000102";
  expect(subscriptionRouteTarget(undefined, offerId)).toEqual({
    returnTo: `/payment/checkout?offer=${offerId}`,
    offerId,
  });
  expect(
    subscriptionRouteTarget("/products/platform-inside", offerId.toUpperCase()),
  ).toEqual({
    returnTo: `/payment/checkout?from=%2Fproducts%2Fplatform-inside&offer=${offerId}`,
    originHref: "/products/platform-inside",
    offerId,
  });
  // Не uuid и повтор параметра витрина не замечает.
  expect(subscriptionOfferParam("materials")).toBeUndefined();
  expect(subscriptionOfferParam([offerId])).toBeUndefined();
  expect(subscriptionOfferParam(`${offerId}x`)).toBeUndefined();
  expect(subscriptionRouteTarget(undefined, "<script>")).toEqual({
    returnTo: "/payment/checkout",
  });
});

it("выбирает первый вариант оплаты предложения из адреса, а без него — первый тариф", () => {
  expect(initialPaymentOptionId(billingOffers, supportOffer.offer.id)).toBe(
    supportOffer.paymentOption.id,
  );
  expect(initialPaymentOptionId(billingOffers, undefined)).toBe(
    materialsOffer.paymentOption.id,
  );
  // Предложения нет на витрине: остаётся обычный выбор.
  expect(
    initialPaymentOptionId(
      billingOffers,
      "00000000-0000-4000-8000-000000000999",
    ),
  ).toBe(materialsOffer.paymentOption.id);
  expect(initialPaymentOptionId([], supportOffer.offer.id)).toBeNull();
});
