import { expect, type Page } from "@playwright/test";

/** Flat legacy Products keep linear navigation without a course chapter frame. */
export async function expectLinearProgrammeReturn(
  page: Page,
  mobile: boolean,
  href: string,
) {
  await expect(page.locator("[data-course-reading]")).toHaveCount(0);
  const top = page.getByRole("navigation", {
    name: "Действия материала",
    exact: true,
  });
  const bottom = page.getByRole("navigation", {
    name: "Действия в конце материала",
    exact: true,
  });
  for (const actions of [top, bottom]) {
    await expect(actions).toHaveCount(1);
    await expect(
      actions.getByRole("link", { name: "Открыть программу", exact: true }),
    ).toHaveAttribute("href", href);
  }
  const dock = page.getByRole("navigation", {
    name: "Уроки продукта",
    exact: true,
  });
  if (mobile) {
    await expect(dock).toBeVisible();
    await expect(
      dock.getByRole("link", { name: /^Программа, урок /u }),
    ).toHaveAttribute("href", href);
  } else await expect(dock).toBeHidden();
  const action = top.getByRole("link", {
    name: "Открыть программу",
    exact: true,
  });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();
  return action;
}
