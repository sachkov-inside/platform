import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";

test("trusted author creates a PostgreSQL draft and opens its current Preview", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto("/authoring/materials/new");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Новый материал" })).toBeVisible();

  await page.getByRole("button", { name: "Вернуться к материалам" }).focus();
  await expect(page.getByRole("button", { name: "Вернуться к материалам" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Название")).toBeFocused();

  await page.getByLabel("Название").fill("Current Preview без fake data");
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page.getByText("Укажите краткое описание до 500 символов.")).toBeVisible();
  await expect(page.getByText("Черновик создан")).toHaveCount(0);

  await page
    .getByLabel("Краткое описание")
    .fill("Черновик проходит Next mutation boundary и сохраняется через Nest MaterialAuthoring.");
  await page.getByRole("combobox", { name: "Тема" }).click();
  await page.getByRole("option", { name: "Platform" }).click();
  await page.getByRole("combobox", { name: "Формат" }).click();
  await page.getByRole("option", { name: "Guide" }).click();
  await page.getByRole("checkbox", { name: "Full stack" }).click({ force: true });
  await page
    .getByRole("textbox", { name: "Содержимое материала" })
    .fill("Текущее сохранённое содержимое из PostgreSQL.");

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);

  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page.getByText("Черновик создан")).toBeVisible();
  await expect(page.getByText("v1").first()).toBeVisible();
  await expect(
    page.getByText("Адрес материала будет создан автоматически при публикации."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview" })).toBeEnabled();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page).toHaveURL(new RegExp(`/authoring/materials/.+/preview$`, "u"));
  await expect(page.getByRole("heading", { name: "Preview текущей версии" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Current Preview без fake data", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Текущее сохранённое содержимое из PostgreSQL.")).toBeVisible();
  await expect(page.getByText("Guide")).toBeVisible();
  await expect(page.getByText("Platform")).toBeVisible();
  await expect(page.getByText("Full stack")).toBeVisible();
  await expect(page.getByText(/Это сохранённый черновик v1/)).toBeVisible();
});

test("trusted author sees a typed not-found state for a missing current Preview", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto(
    "/authoring/materials/94000000-0000-4000-8000-000000000099/preview",
  );

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Preview не найден" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Повторить" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Вернуться в редактор" })).toBeVisible();
});

test("guest cannot reach the production Material editor", async ({ page }) => {
  const response = await page.goto("/authoring/materials/new");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Нет доступа к редактору" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Создать черновик" })).toHaveCount(0);
});

async function addFullStackSession(context: BrowserContext) {
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const session = process.env.FULLSTACK_LOGTO_SESSION;
  if (cookieName === undefined || session === undefined) {
    throw new Error("Full-stack Logto session fixture is missing");
  }
  await context.addCookies([
    {
      httpOnly: true,
      name: cookieName,
      sameSite: "Lax",
      url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000",
      value: session,
    },
  ]);
}
