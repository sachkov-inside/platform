import { expect, type Page } from "@playwright/test";

/** Check the viewport-specific course navigation and return its programme link. */
export async function expectCourseProgrammeReturn(
  page: Page,
  mobile: boolean,
  href: string,
) {
  const course = page.locator("[data-course-reading]:visible");
  await expect(course).toHaveCount(1);
  await expect(
    course.getByRole("navigation", { name: "Действия материала", exact: true }),
  ).toHaveCount(1);
  await expect(
    course.getByRole("navigation", {
      name: mobile ? "Навигация по урокам" : "Шаги курса",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    course.getByRole("navigation", {
      name: "Действия в конце материала",
      exact: true,
    }),
  ).toHaveCount(0);
  if (mobile) {
    const trigger = course.getByRole("button", {
      name: "Вся программа",
      exact: true,
    });
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toBeVisible();
    await trigger.click();
    const dialog = course.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Закрыть программу", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  }
  const action = mobile
    ? course
        .getByRole("navigation", { name: "Действия материала", exact: true })
        .getByRole("link", { name: "К курсу", exact: true })
    : course.getByRole("link", { name: "Вся программа", exact: true });
  await expect(action).toHaveCount(1);
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute("href", href);
  return action;
}
