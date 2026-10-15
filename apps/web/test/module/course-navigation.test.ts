import { describe, expect, it } from "vitest";

import {
  publicMobileNavigationItems,
  navigationItemsFor,
} from "@/widgets/application-shell";

describe("site navigation without a separate course entry", () => {
  it("keeps Home, Bookmarks and Profile in mobile navigation", () => {
    expect(publicMobileNavigationItems.map((item) => item.label)).toEqual([
      "Главная",
      "Закладки",
      "Профиль",
    ]);
  });

  it("keeps the editor last in the desktop header", () => {
    expect(
      navigationItemsFor({ canManageMaterials: true }).map(
        (item) => item.label,
      ),
    ).toEqual(["Главная", "Закладки", "Редактор"]);
    expect(
      navigationItemsFor({ canManageMaterials: false }).map(
        (item) => item.label,
      ),
    ).toEqual(["Главная", "Закладки"]);
  });
});
