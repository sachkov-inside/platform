import { expect, test } from "@playwright/test";

const programme = "/products/reference-course/programme";

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
            frame.height <= 50 &&
            [...element.querySelectorAll("a,button")].every((control) => {
              const box = control.getBoundingClientRect();
              return (
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
        probe.style.backgroundColor = "var(--accent)";
        element.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return getComputedStyle(element).backgroundColor === expected;
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
