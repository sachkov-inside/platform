import { describe, expect, it } from "vitest";

import {
  mobileNavigationItemsFor,
  navigationItemsFor,
} from "@/widgets/application-shell";

describe("course item in the site navigation", () => {
  it("appears right after Home only for a person with an open product", () => {
    expect(
      mobileNavigationItemsFor({ hasCourse: false }).map((item) => item.label),
    ).toEqual(["Главная", "Закладки", "Профиль"]);
    expect(
      mobileNavigationItemsFor({ hasCourse: true }).map((item) => item.label),
    ).toEqual(["Главная", "Курс", "Закладки", "Профиль"]);
    expect(mobileNavigationItemsFor({ hasCourse: true })[1]?.href).toBe(
      "/learning",
    );
  });

  it("keeps the editor last in the desktop header", () => {
    expect(
      navigationItemsFor({ canManageMaterials: true, hasCourse: true }).map(
        (item) => item.label,
      ),
    ).toEqual(["Главная", "Курс", "Закладки", "Редактор"]);
    expect(
      navigationItemsFor({ canManageMaterials: false }).map(
        (item) => item.label,
      ),
    ).toEqual(["Главная", "Закладки"]);
  });
});
