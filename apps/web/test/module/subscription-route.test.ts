import { expect, it } from "vitest";

import {
  purchaseInvitation,
  subscriptionHrefFrom,
  subscriptionRouteTarget,
} from "@/shared/routing/subscription-route";

it("сохраняет контекст страницы продукта и отбрасывает внешние адреса", () => {
  expect(subscriptionRouteTarget("/products/platform-inside")).toEqual({
    returnTo: "/subscription?from=%2Fproducts%2Fplatform-inside",
    originHref: "/products/platform-inside",
  });
  // Прежние адреса продукта перенаправляются на `/products/`, поэтому возврат на них остаётся.
  expect(subscriptionRouteTarget("/guides/platform-inside").originHref).toBe(
    "/guides/platform-inside",
  );
  expect(subscriptionRouteTarget("/series/platform-inside").originHref).toBe(
    "/series/platform-inside",
  );
  expect(subscriptionRouteTarget(["/topics/platform"]).originHref).toBe(
    "/topics/platform",
  );
  expect(subscriptionRouteTarget(undefined)).toEqual({
    returnTo: "/subscription",
  });
  expect(subscriptionRouteTarget("https://example.test/guides/x")).toEqual({
    returnTo: "/subscription",
  });
  expect(subscriptionRouteTarget("//example.test")).toEqual({
    returnTo: "/subscription",
  });
  expect(subscriptionRouteTarget("/authoring/materials")).toEqual({
    returnTo: "/subscription",
  });
});

it("строит ссылку витрины со страницы продукта", () => {
  expect(subscriptionHrefFrom("/products/platform-inside")).toBe(
    "/subscription?from=%2Fproducts%2Fplatform-inside",
  );
  expect(subscriptionHrefFrom("https://example.test")).toBe("/subscription");
});

it("ведёт призыв к покупке внутрь платформы и молчит, когда покупать нечего", () => {
  // Своя цена руководства важнее тарифов: человек уже выбрал, что берёт.
  expect(
    purchaseInvitation({
      guide: { slug: "platform-inside", sold: true },
      subscriptionOffered: true,
      from: "/materials/developer-pipeline",
    }),
  ).toEqual({ kind: "guide", href: "/products/platform-inside/buy" });
  // Без своей цены остаётся витрина, и она помнит, откуда пришёл человек.
  expect(
    purchaseInvitation({
      guide: { slug: "platform-inside", sold: false },
      subscriptionOffered: true,
      from: "/materials/developer-pipeline",
    }),
  ).toEqual({
    kind: "subscription",
    href: "/subscription?from=%2Fmaterials%2Fdeveloper-pipeline",
  });
  expect(purchaseInvitation({ subscriptionOffered: true })).toEqual({
    kind: "subscription",
    href: "/subscription",
  });
  // Выключенная продажа не зовёт никуда, даже когда человек стоит в руководстве.
  expect(
    purchaseInvitation({
      guide: { slug: "platform-inside", sold: false },
      subscriptionOffered: false,
      from: "/products/platform-inside/programme",
    }),
  ).toBeNull();
  expect(purchaseInvitation({ subscriptionOffered: false })).toBeNull();
});
