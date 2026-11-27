import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { learningInterceptionFile } from "../support/learning-interception";
import {
  openProgrammeChapter,
  programmeChapterWindow,
} from "../support/programme-chapter";

test("the shared populated Product keeps main lessons and practice separate from extra material", async ({
  page,
}) => {
  await page.goto("/products/synthetic-learning/programme");
  await expect(
    page.getByRole("heading", {
      name: "Учебный курс: от идеи к выпуску",
      exact: true,
    }),
  ).toBeVisible();
  // Main lessons and their practice live in chapter windows: two lessons and the task in the
  // first chapter, one lesson in the second.
  const chapter = await openProgrammeChapter(page, 1);
  const title = chapter.getByRole("heading", { level: 2 });
  await expect(title).toBeFocused();
  await expect(title).toHaveCSS("outline-style", "none");
  await expect(
    chapter.getByRole("link", { name: /Учебный пример: работа над проектом/ }),
  ).toBeVisible();
  await expect(
    chapter.getByRole("link", { name: /Учебный пример: покажи результат/ }),
  ).toBeVisible();
  await expect(chapter.locator("[data-product-ordinal]")).toHaveCount(2);
  await chapter.getByRole("button", { name: /^Следующая/u }).click();
  await expect(
    chapter.getByRole("link", { name: /Учебный пример: проверка выпуска/ }),
  ).toBeVisible();
  await expect(chapter.locator("[data-product-ordinal]")).toHaveCount(1);
  await chapter.getByRole("button", { name: "Закрыть главу" }).click();
  await expect(programmeChapterWindow(page)).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Разделы продукта" })
    .getByRole("button", { name: /Материалы/ })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Материалы курса" })
      .getByRole("list")
      .last()
      .getByRole("listitem"),
  ).toHaveCount(4);
});

test("the mobile programme reserves its dock clearance when the storage notice returns", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/products/synthetic-learning/programme");
  const nav = page.locator(
    'nav[data-layout="sections"][aria-label="Разделы продукта"]',
  );
  const notice = page.getByRole("region", { name: "Хранение в браузере" });
  const clearance = () =>
    nav.evaluate((dock) => {
      const spacer = dock.previousElementSibling;
      if (spacer?.hasAttribute("data-course-navigation-space") !== true)
        throw new Error("The programme has no dock spacer");
      return Math.round(
        spacer.getBoundingClientRect().height -
          dock.getBoundingClientRect().height -
          Number.parseFloat(getComputedStyle(dock).bottom),
      );
    });
  await expect(nav).toBeVisible();
  await notice.getByRole("button", { name: "Понятно" }).click();
  await expect(notice).toBeHidden();
  await expect.poll(clearance).toBe(12);
  const originalBottom = await nav.evaluate((dock) =>
    Number.parseFloat(getComputedStyle(dock).bottom),
  );

  const other = await context.newPage();
  try {
    await other.goto("/legal/terms");
    await other.evaluate(() => {
      localStorage.clear();
    });
    await expect(notice).toBeVisible();
    await expect
      .poll(() =>
        nav.evaluate((dock) =>
          Number.parseFloat(getComputedStyle(dock).bottom),
        ),
      )
      .toBeGreaterThan(originalBottom);
    await expect.poll(clearance).toBe(12);
    await notice.getByRole("button", { name: "Понятно" }).click();
    await expect(notice).toBeHidden();
    await expect
      .poll(() =>
        nav.evaluate((dock) =>
          Number.parseFloat(getComputedStyle(dock).bottom),
        ),
      )
      .toBe(originalBottom);
    await expect.poll(clearance).toBe(12);
  } finally {
    await other.close();
  }
});

test("the shared supplementary lesson downloads its declared current file through the real web route", async ({
  page,
  context,
  baseURL,
}) => {
  const backendPort = process.env["FAKE_BACKEND_PORT"];
  if (backendPort === undefined || baseURL === undefined)
    throw new Error("Navigation addresses required");
  const { wrapSession } = await import("@logto/node");
  await context.addCookies([
    {
      name: "logto_inside-web-navigation",
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      value: await wrapSession(
        {
          accessToken: JSON.stringify({
            [`@http://127.0.0.1:${backendPort}`]: {
              token: "synthetic-learning-holder",
              scope: "",
              // deterministic-test-allow wall-clock: the separate Web and Logto processes check the live expiry of this synthetic session.
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            },
          }),
          idToken: "synthetic.learning.holder",
          refreshToken: "synthetic-learning-refresh",
        },
        "inside-navigation-logto-cookie-secret-key",
      ),
    },
  ]);
  await page.goto("/materials/synthetic-reference");
  const lesson = page.getByRole("main").getByRole("article");
  const action = lesson.getByRole("link", {
    name: "Скачать шаблон результата (.txt)",
    exact: true,
  });
  await expect(action).toHaveAttribute("download");
  await expect(lesson.getByText("synthetic-result.txt")).toBeVisible();
  const assertDownload = async () => {
    const pending = page.waitForEvent("download");
    await action.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("synthetic-result.txt");
    const path = await download.path();
    expect(await readFile(path, "utf8")).toBe(
      "Учебный результат: первый шаг и повторяемая проверка.\n",
    );
  };
  await assertDownload();
  await page.route(
    "**/api/products/97000000-0000-4000-8000-000000000001/artifact-sources/synthetic-scenarios%3Aresult/file",
    (route) => route.fulfill(learningInterceptionFile()),
  );
  await assertDownload();
});
