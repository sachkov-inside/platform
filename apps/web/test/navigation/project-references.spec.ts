import { expect, test, type Page } from "@playwright/test";

const programme = "/products/reference-course/programme";
const lesson = `/materials/reference-lesson-5?from=${encodeURIComponent(programme)}`;

async function referenceGroup(page: Page) {
  if (page.viewportSize()?.width === 390) {
    await page.getByRole("button", { name: "Вся программа" }).click();
    return page
      .getByRole("dialog")
      .getByRole("navigation", { name: "Дополнительные материалы" });
  }
  return page
    .getByRole("complementary", { name: "Текущая глава" })
    .getByRole("navigation", { name: "Дополнительные материалы" });
}

async function scrollPosition(page: Page) {
  return page.evaluate(() =>
    Math.max(
      document.querySelector<HTMLElement>("[data-application-content]")
        ?.scrollTop ?? 0,
      window.scrollY,
    ),
  );
}

test("reference navigation preserves nine steps and restores the originating lesson", async ({
  page,
}) => {
  await page.goto(lesson);
  await expect(
    page.getByRole("heading", { name: "Урок 5", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Reflect.get(window.history.state ?? {}, "insideReader") !== undefined,
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(
      "[data-application-content]",
    );
    if (root !== null && root.scrollHeight > root.clientHeight)
      root.scrollTop = 500;
    else window.scrollTo(0, 500);
  });
  await expect.poll(() => scrollPosition(page)).toBe(500);
  const project = (await referenceGroup(page)).getByRole("link", {
    name: "Описание проекта",
  });
  await expect(project).toHaveAttribute(
    "href",
    /anchor=material%3Areference-lesson-5/u,
  );
  await project.click();
  await expect(
    page.getByRole("heading", { name: "Описание проекта", exact: true }),
  ).toBeVisible();
  const group = await referenceGroup(page);
  const navigation =
    page.viewportSize()?.width === 390
      ? page.getByRole("dialog")
      : page.getByRole("complementary", { name: "Текущая глава" });
  await expect(navigation.locator("[data-course-step]")).toHaveCount(9);
  await expect(
    navigation.locator('[data-course-step="material:reference-lesson-5"]'),
  ).toHaveAttribute("aria-current", "step");
  await expect(
    group.getByRole("link", { name: "Описание проекта" }),
  ).toHaveAttribute("aria-current", "page");
  await group.getByRole("link", { name: "Бриф заказчика" }).click();
  await expect(
    page.getByRole("heading", { name: "Бриф заказчика", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "К уроку", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(lesson);
  await expect.poll(() => scrollPosition(page)).toBe(500);
});

test("programme references keep course navigation without adding a numbered step; standalone links remain standalone", async ({
  page,
}) => {
  await page.goto(
    `/materials/aie-project?from=${encodeURIComponent(programme)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Описание проекта", exact: true }),
  ).toBeVisible();
  await referenceGroup(page);
  const navigation =
    page.viewportSize()?.width === 390
      ? page.getByRole("dialog")
      : page.getByRole("complementary", { name: "Текущая глава" });
  await expect(navigation.locator("[data-course-step]")).toHaveCount(9);
  await expect(navigation.locator('[aria-current="step"]')).toHaveCount(0);
  if (page.viewportSize()?.width === 390)
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Закрыть" })
      .click();
  await expect(
    page.getByRole("link", { name: "К программе", exact: true }),
  ).toHaveAttribute("href", programme);
  await page.goto("/materials/aie-project");
  await expect(
    page.getByRole("heading", { name: "Описание проекта", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-course-reading]")).toHaveCount(0);
});
