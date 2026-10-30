import { expect, test } from "@playwright/test";

const programme = "/products/reference-course/programme";

test("mobile course navigation opens the programme and returns from lessons and references to the course programme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const slug of ["reference-lesson-5", "aie-project"]) {
    await page.goto(`/materials/${slug}?from=${encodeURIComponent(programme)}`);
    const navigation = page.getByRole("navigation", {
      name: "Навигация по урокам",
    });
    await expect(navigation).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "К прохождению курса" }),
    ).toHaveCount(0);
    const trigger = navigation.getByRole("button", { name: "Вся программа" });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Программа: Курс со справочными документами",
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    const returnToCourse = dialog.getByRole("link", {
      name: "К прохождению курса",
    });
    await expect(returnToCourse).toHaveAttribute("href", programme);
    await returnToCourse.click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(programme);
  }
});

test("the course sidebar stays mounted while only the material changes", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "This regression targets the persistent desktop chapter rail.",
  );
  const backendPort = process.env["FAKE_BACKEND_PORT"];
  if (backendPort === undefined) throw new Error("Missing fake backend port");
  const control = `http://127.0.0.1:${backendPort}/__control`;
  await page.goto(
    `/materials/reference-lesson-5?from=${encodeURIComponent(programme)}`,
  );
  await expect(page.locator("[data-course-reading-host]")).toBeVisible();
  const rail = page.getByRole("complementary", { name: "Текущая глава" });
  await expect(rail).toBeVisible();
  await expect(
    rail.getByRole("link", { name: "Страница курса", exact: true }),
  ).toHaveAttribute("href", programme);
  await expect(
    page
      .getByRole("navigation", { name: "Действия материала", exact: true })
      .getByRole("link", { name: "Дальше", exact: true }),
  ).toHaveAttribute(
    "href",
    `/materials/reference-lesson-6?from=${encodeURIComponent(programme)}`,
  );
  await rail.evaluate((node) => {
    node.setAttribute("data-retained-probe", "true");
    const observer = new MutationObserver(() => {
      if (!node.isConnected) node.setAttribute("data-retained-probe", "false");
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await request.post(control, { data: { delayMs: 1500 } });
  try {
    await rail.getByRole("link", { name: "Урок 6", exact: true }).click();
    const loading = page.locator(
      '[data-material-reader-state="loading"]:visible',
    );
    await expect(loading).toBeVisible();
    await expect(
      rail.getByRole("link", { name: "Урок 6", exact: true }),
    ).toHaveAttribute("aria-current", "step");
    const railBox = await rail.boundingBox();
    const loadingBox = await loading.boundingBox();
    expect(railBox).not.toBeNull();
    expect(loadingBox).not.toBeNull();
    if (railBox === null || loadingBox === null)
      throw new Error("Missing course frame geometry");
    expect(loadingBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
    await expect(
      page.getByRole("heading", { name: "Урок 6", exact: true }),
    ).toBeVisible();
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute("data-retained-probe", "true");
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Урок 5", exact: true }),
    ).toBeVisible();
    await expect(
      rail.getByRole("link", { name: "Урок 5", exact: true }),
    ).toHaveAttribute("aria-current", "step");
  } finally {
    await request.post(control, { data: { delayMs: 0 } });
  }
});

test("the desktop chapter list opens inside the rail and returns to the steps", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The chapter list belongs to the desktop rail.",
  );
  const course = "/products/performance-course/programme";
  await page.goto(
    `/materials/performance-lesson-1?from=${encodeURIComponent(course)}`,
  );
  const rail = page.getByRole("complementary", { name: "Текущая глава" });
  const heading = rail.getByRole("button", { name: /^Глава 1 из 2 Начало/ });
  await expect(heading).toHaveAttribute("aria-expanded", "false");
  await heading.click();
  const chapters = rail.getByRole("navigation", { name: "Главы курса" });
  await expect(chapters.getByRole("button")).toHaveCount(2);
  const railBox = await rail.boundingBox();
  const listBox = await chapters.boundingBox();
  if (railBox === null || listBox === null)
    throw new Error("Chapter rail has no layout box");
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(
    railBox.x + railBox.width,
  );
  await page.keyboard.press("Escape");
  await expect(heading).toHaveAttribute("aria-expanded", "false");
  await expect(heading).toBeFocused();
  await heading.click();
  await chapters.getByRole("button", { name: /^Глава 2 Продолжение/ }).click();
  const second = rail.getByRole("button", {
    name: /^Глава 2 из 2 Продолжение/,
  });
  await expect(second).toBeFocused();
  await expect(
    rail
      .getByRole("navigation", { name: "Шаги текущей главы" })
      .getByRole("link", { name: "Материал 55", exact: true }),
  ).toBeVisible();
});

test("mobile material actions and breadcrumbs fit one row", async ({
  page,
}) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(
      `/materials/reference-lesson-5?from=${encodeURIComponent(programme)}`,
    );
    const panel = page.getByRole("navigation", {
      name: "Действия материала",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect
      .poll(() =>
        panel.evaluate((element) => {
          const frame = element.getBoundingClientRect();
          return (
            frame.height <= 56 &&
            [...element.querySelectorAll("a,button")].every((control) => {
              const box = control.getBoundingClientRect();
              return (
                box.height >= 44 &&
                box.left >= frame.left &&
                box.right <= frame.right &&
                box.top >= frame.top &&
                box.bottom <= frame.bottom
              );
            })
          );
        }),
      )
      .toBe(true);
    const next = panel.getByRole("link", { name: "Дальше", exact: true });
    await expect(next).toBeVisible();
    expect(
      await next.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--action)";
        element.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const surface = getComputedStyle(element, "::before");
        return (
          surface.backgroundColor === expected &&
          parseFloat(surface.height) === 36
        );
      }),
    ).toBe(true);
    const breadcrumbs = page
      .getByRole("navigation", { name: "Хлебные крошки" })
      .first();
    expect(
      await breadcrumbs.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBeLessThanOrEqual(44);
  }
});

test("accepted Reader actions fit desktop, tablet and phone with the same navigation targets", async ({
  page,
}, testInfo) => {
  const widths =
    testInfo.project.name === "desktop-chromium" ? [1440, 820] : [390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      `/materials/reference-lesson-5?from=${encodeURIComponent(programme)}`,
    );
    await expect(
      page.getByRole("heading", { name: "Урок 5", exact: true }),
    ).toBeVisible();
    // The end of the lesson keeps one step navigation: the bottom action panel.
    await expect(
      page.getByRole("navigation", { name: "Шаги курса", exact: true }),
    ).toHaveCount(0);
    for (const [position, name] of [
      ["top", "Действия материала"],
      ["bottom", "Действия в конце материала"],
    ] as const) {
      const panel = page.getByRole("navigation", { name, exact: true });
      await panel.scrollIntoViewIfNeeded();
      const back = panel.getByRole("link", { name: "Назад", exact: true });
      const next = panel.getByRole("link", { name: "Дальше", exact: true });
      await expect(back).toHaveAttribute("href", programme);
      await expect(next).toHaveAttribute(
        "href",
        `/materials/reference-lesson-6?from=${encodeURIComponent(programme)}`,
      );
      await expect(
        panel.getByRole("link", { name: "Сохранить", exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole("link", { name: "Изучено", exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", { name: /^Поделиться материалом/u }),
      ).toBeVisible();
      const geometry = await panel.evaluate((el) => ({
        client: el.clientWidth,
        scroll: el.scrollWidth,
        controls: [...el.querySelectorAll("a,button")].map((control) => ({
          width: control.getBoundingClientRect().width,
          height: control.getBoundingClientRect().height,
        })),
      }));
      expect(geometry.scroll).toBe(geometry.client);
      for (const control of geometry.controls) {
        expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.height).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth ===
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const capture = testInfo.outputPath(
        `reader-A-${String(width)}-${position}.png`,
      );
      await page.screenshot({ path: capture });
      await testInfo.attach(`reader-A-${String(width)}-${position}`, {
        path: capture,
        contentType: "image/png",
      });
    }
    const top = page.getByRole("navigation", {
      name: "Действия материала",
      exact: true,
    });
    await top.getByRole("link", { name: "Назад", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      top.getByRole("link", { name: "Сохранить", exact: true }),
    ).toBeFocused();
    expect(
      await top
        .getByRole("link", { name: "Сохранить", exact: true })
        .evaluate(
          (el) =>
            el.matches(":focus-visible") &&
            getComputedStyle(el).outlineStyle !== "none",
        ),
    ).toBe(true);
  }
  await page.goto(
    `/materials/reference-lesson-9?from=${encodeURIComponent(programme)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Урок 9", exact: true }),
  ).toBeVisible();
  for (const name of ["Действия материала", "Действия в конце материала"])
    await expect(
      page
        .getByRole("navigation", { name, exact: true })
        .getByRole("link", { name: "Дальше", exact: true }),
    ).toHaveCount(0);
});

test("rapid mobile arrows keep the programme selection on the displayed lesson", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/materials/reference-lesson-5?from=${encodeURIComponent(programme)}`,
  );
  await expect(page.locator("[data-course-reading-host]")).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: "Навигация по урокам",
  });
  const backendPort = process.env["FAKE_BACKEND_PORT"];
  if (backendPort === undefined) throw new Error("Missing fake backend port");
  const control = `http://127.0.0.1:${backendPort}/__control`;
  await request.post(control, { data: { delayMs: 1500 } });
  try {
    await navigation
      .getByRole("link", { name: "Следующий шаг", exact: true })
      .click();
    await navigation
      .getByRole("link", { name: "Следующий шаг", exact: true })
      .click();
    await navigation
      .getByRole("link", { name: "Предыдущий шаг", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Урок 6", exact: true }),
    ).toBeVisible();
    await navigation.getByRole("button", { name: "Вся программа" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Программа: Курс со справочными документами",
    });
    await expect(dialog.locator('[aria-current="step"]')).toHaveText("Урок 6");
  } finally {
    await request.post(control, { data: { delayMs: 0 } });
  }
});
