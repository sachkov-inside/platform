import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { learningInterceptionFile } from "../support/learning-interception";

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
  await expect(
    page.getByRole("link", { name: /Учебный пример: работа над проектом/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Учебный пример: покажи результат/ }),
  ).toBeVisible();
  await expect(page.locator("[data-product-ordinal]")).toHaveCount(3);
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
  const action = page.getByRole("link", {
    name: "Скачать шаблон результата (.txt)",
    exact: true,
  });
  await expect(action).toHaveAttribute("download");
  await expect(page.getByText(/synthetic-result.txt/)).toBeVisible();
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
