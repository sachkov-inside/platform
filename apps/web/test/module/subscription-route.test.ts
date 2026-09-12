import { expect, it } from "vitest";

import {
  purchaseInvitation,
  subscriptionHrefFrom,
  subscriptionRouteTarget,
} from "@/shared/routing/subscription-route";

it("сохраняет контекст страницы руководства и отбрасывает внешние адреса", () => {
  expect(subscriptionRouteTarget("/guides/platform-inside")).toEqual({
    returnTo: "/subscription?from=%2Fguides%2Fplatform-inside",
    originHref: "/guides/platform-inside",
  });
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

it("строит ссылку витрины со страницы руководства", () => {
  expect(subscriptionHrefFrom("/guides/platform-inside")).toBe(
    "/subscription?from=%2Fguides%2Fplatform-inside",
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
  ).toEqual({ kind: "guide", href: "/guides/platform-inside/buy" });
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
      from: "/guides/platform-inside/programme",
    }),
  ).toBeNull();
  expect(purchaseInvitation({ subscriptionOffered: false })).toBeNull();
});
