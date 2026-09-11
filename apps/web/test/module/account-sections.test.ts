import { expect, it } from "vitest";

import { accountSections, visibleAccountSections } from "@/widgets/account-cabinet";

it("каждый раздел кабинета живёт по своему адресу", () => {
  const addresses = accountSections.map((section) => section.href);

  expect(new Set(addresses).size).toBe(addresses.length);
  expect(addresses).toContain("/account");
  expect(addresses.every((href) => href.startsWith("/account"))).toBe(true);
});

it("прячет «Подписку», пока её не продают и её нет у человека", () => {
  const hidden = visibleAccountSections({
    subscriptionOffered: false,
    subscriptionOwned: false,
  });

  expect(hidden.map((section) => section.id)).toEqual([
    "profile",
    "access",
    "purchases",
    "notifications",
  ]);
});

it("показывает «Подписку», когда её продают или когда она уже есть", () => {
  const offered = visibleAccountSections({
    subscriptionOffered: true,
    subscriptionOwned: false,
  });
  const owned = visibleAccountSections({
    subscriptionOffered: false,
    subscriptionOwned: true,
  });

  expect(offered.some((section) => section.id === "subscription")).toBe(true);
  expect(owned.some((section) => section.id === "subscription")).toBe(true);
});
