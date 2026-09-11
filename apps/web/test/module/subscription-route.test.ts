import { expect, it } from "vitest";

import {
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
