import { expect, type Page } from "@playwright/test";

/** The accepted course Reader exposes one programme entry per viewport. */
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
    course.getByRole("navigation", { name: "Шаги курса", exact: true }),
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
  }
  const action = mobile
    ? course
        .getByRole("dialog")
        .getByRole("link", { name: "Страница программы", exact: true })
    : course.getByRole("link", { name: "Вся программа", exact: true });
  await expect(action).toHaveCount(1);
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute("href", href);
  return action;
}
