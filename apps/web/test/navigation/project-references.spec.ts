import { expect, test, type Page } from "@playwright/test";
import { expectCourseReadingHost } from "../support/course-reading-host";

const programme = "/products/reference-course/programme";
const lesson = `/materials/reference-lesson-5?from=${encodeURIComponent(programme)}`;

async function referenceGroup(page: Page) {
  await expectCourseReadingHost(page);
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
  // The saved reader view below records the rail of whichever tree exists, so scroll after the handoff.
  await expectCourseReadingHost(page);
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

test("a body link to another programme step moves the chapter steps; a body link to a reference stays a reference", async ({
  page,
}) => {
  const phone = page.viewportSize()?.width === 390;
  await page.goto(lesson);
  await expect(
    page.getByRole("heading", { name: "Урок 5", exact: true }),
  ).toBeVisible();
  const body = page.locator("[data-reader-body]").filter({ visible: true });
  await expect(
    body.getByRole("link", { name: "проект из текста", exact: true }),
  ).toHaveAttribute(
    "href",
    /view=reference&anchor=material%3Areference-lesson-5/u,
  );
  await expect(
    body.getByRole("link", { name: "раздел этого урока", exact: true }),
  ).toHaveAttribute("href", "#раздел-урока");
  const step = body.getByRole("link", {
    name: "Сразу к уроку 7",
    exact: true,
  });
  const href = await step.getAttribute("href");
  expect(href).not.toContain("view=reference");
  expect(href).not.toContain("anchor=");
  expect(href).toMatch(
    /^\/materials\/reference-lesson-7\?from=.*#раздел-урока$/u,
  );
  await step.click();
  await expect(
    page.getByRole("heading", { name: "Урок 7", exact: true }),
  ).toBeVisible();
  await expectCourseReadingHost(page);
  if (phone) await page.getByRole("button", { name: "Вся программа" }).click();
  const navigation = phone
    ? page.getByRole("dialog")
    : page.getByRole("complementary", { name: "Текущая глава" });
  await expect(
    navigation.locator('[data-course-step="material:reference-lesson-7"]'),
  ).toHaveAttribute("aria-current", "step");
  await expect(
    page.getByText("Шаг 7 из 9").filter({ visible: true }).first(),
  ).toBeVisible();
});

test("a programme lesson opened from the catalogue keeps its chapter without step navigation", async ({
  page,
}) => {
  await page.goto(
    `/materials/reference-lesson-5?from=${encodeURIComponent(`${programme}?part=materials&at=reference-lesson-5`)}&view=reference`,
  );
  await expect(
    page.getByRole("heading", { name: "Урок 5", exact: true }),
  ).toBeVisible();
  await expectCourseReadingHost(page);
  if (page.viewportSize()?.width === 390)
    await page.getByRole("button", { name: "Вся программа" }).click();
  const navigation =
    page.viewportSize()?.width === 390
      ? page.getByRole("dialog")
      : page.getByRole("complementary", { name: "Текущая глава" });
  await expect(
    navigation.locator('[data-course-step="material:reference-lesson-5"]'),
  ).toHaveAttribute("aria-current", "step");
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(0);
  if (page.viewportSize()?.width === 390)
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Закрыть" })
      .click();
  await expect(
    page.getByRole("link", { name: "К уроку", exact: true }),
  ).toHaveCount(0);
  for (const name of ["Предыдущий шаг", "Следующий шаг"])
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Хлебные крошки" }),
  ).toContainText("Глава 1");
  await expect(page.getByText("Дополнительный материал")).toHaveCount(0);
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
  // The end action panel returns to the programme; no second return link repeats it below.
  await expect(
    page
      .getByRole("navigation", { name: "Действия в конце материала" })
      .getByRole("link", { name: "Назад", exact: true }),
  ).toHaveAttribute("href", programme);
  await expect(
    page.getByRole("link", { name: "К программе", exact: true }),
  ).toHaveCount(0);
  await page.goto("/materials/aie-project");
  await expect(
    page.getByRole("heading", { name: "Описание проекта", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-course-reading]")).toHaveCount(0);
});

test("supplementary navigation expands with keyboard and preserves the course anchor", async ({
  page,
}) => {
  await page.goto(lesson);
  const group = await referenceGroup(page);
  const links = group.getByRole("link");
  await expect(links).toHaveCount(3);
  const toggle = group.getByRole("button", { name: "Показать ещё" });
  // Hydration can replace the opaque React ID; read the current pair together.
  await expect
    .poll(() =>
      group.locator("ul").evaluate((list) => {
        const controlledId = list.id;
        return (
          list.isConnected &&
          controlledId.length > 0 &&
          list
            .closest("nav")
            ?.querySelector("button[aria-controls]")
            ?.getAttribute("aria-controls") === controlledId
        );
      }),
    )
    .toBe(true);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(links).toHaveCount(6);
  await expect(group.getByRole("button", { name: "Скрыть" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("Space");
  await expect(links).toHaveCount(3);
  await toggle.click();
  const extra = group.getByRole("link", { name: "Дополнение 2" });
  await expect(extra).toHaveAttribute(
    "href",
    /anchor=material%3Areference-lesson-5/u,
  );
  await extra.click();
  await expect(
    page.getByRole("heading", { name: "Дополнение 2", exact: true }),
  ).toBeVisible();
});
