import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const currentMaterialEditorUrl = /\/authoring\/materials\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\?.*)?$/u;

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
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await expect(page.getByText("v1").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview" })).toBeEnabled();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page).toHaveURL(new RegExp(`/authoring/materials/.+/preview(?:\\?.*)?$`, "u"));
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

test("trusted author finds every Material and returns from Editor to the same list query", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const listUrl =
    "/authoring/materials?search=%D0%9A%D0%B0%D0%BA+%D1%83%D1%81%D1%82%D1%80%D0%BE%D0%B5%D0%BD&state=published";
  const response = await page.goto(listUrl);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Материалы", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Как устроен Inside Platform" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Состояние публикации" })).toHaveValue(
    "published",
  );

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await page.getByRole("link", { name: "Редактировать" }).click();
  await expect(page.getByRole("heading", { name: "Как устроен Inside Platform" })).toBeVisible();
  await page.getByRole("button", { name: "Вернуться к материалам" }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByRole("link", { name: "Как устроен Inside Platform" })).toBeVisible();
});

test("full-state Save is live and a stale editor preserves local input through lifecycle changes", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await fillPublishableDraft(page, "Mutable Material");
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  const editorUrl = page.url();
  const materialId = new URL(editorUrl).pathname.split("/").at(-1);
  if (materialId === undefined) {
    throw new Error("Current Material route has no identifier");
  }
  const slug = `mutable-material-${materialId}`;

  const stalePage = await context.newPage();
  await stalePage.goto(editorUrl);
  await expect(stalePage.getByText("v1").first()).toBeVisible();

  await page.getByLabel("Название").fill("Mutable Material — winner");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("v2").first()).toBeVisible();

  const localSummary = "Локальный ввод stale editor должен остаться на месте.";
  await stalePage.getByLabel("Краткое описание").fill(localSummary);
  await stalePage.getByRole("button", { name: "Сохранить" }).click();
  await expect(stalePage.getByRole("main").getByRole("alert")).toContainText(
    "Материал изменился в другой сессии",
  );
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(localSummary);

  const currentPreviewPromise = context.waitForEvent("page");
  await stalePage.getByRole("button", { name: "Сравнить" }).click();
  const currentPreview = await currentPreviewPromise;
  await currentPreview.waitForLoadState();
  await expect(
    currentPreview.getByRole("heading", { name: "Mutable Material — winner", level: 1 }),
  ).toBeVisible();
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(localSummary);

  const currentEditorPromise = context.waitForEvent("page");
  await stalePage.getByRole("button", { name: "Открыть текущую" }).click();
  const currentEditor = await currentEditorPromise;
  await currentEditor.waitForLoadState();
  await expect(currentEditor.getByText("v2").first()).toBeVisible();
  await expect(currentEditor.getByLabel("Название")).toHaveValue(
    "Mutable Material — winner",
  );
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(localSummary);

  await page.getByLabel("Адрес").fill(slug);
  await page.getByRole("combobox", { name: "Публикация" }).click();
  await page.getByRole("option", { name: "Опубликован" }).click();
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("v3").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Публикация" })).toContainText(
    "Опубликован",
  );

  const publicPage = await context.newPage();
  await publicPage.goto(`/materials/${slug}`);
  await expect(
    publicPage.getByRole("heading", { name: "Mutable Material — winner", level: 1 }),
  ).toBeVisible();
  await expect(publicPage.getByText("Текущее сохранённое содержимое из PostgreSQL.")).toBeVisible();

  await page.getByRole("combobox", { name: "Публикация" }).click();
  await page.getByRole("option", { name: "Снят с публикации" }).click();
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("v4").first()).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { name: "Материал не найден" })).toBeVisible();
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

async function fillPublishableDraft(page: Page, title: string) {
  await page.getByLabel("Название").fill(title);
  await page
    .getByLabel("Краткое описание")
    .fill("Full-state Save проходит через production Editor и Nest MaterialAuthoring.");
  await page.getByRole("combobox", { name: "Тема" }).click();
  await page.getByRole("option", { name: "Platform" }).click();
  await page.getByRole("combobox", { name: "Формат" }).click();
  await page.getByRole("option", { name: "Guide" }).click();
  await page
    .getByRole("textbox", { name: "Содержимое материала" })
    .fill("Текущее сохранённое содержимое из PostgreSQL.");
}
