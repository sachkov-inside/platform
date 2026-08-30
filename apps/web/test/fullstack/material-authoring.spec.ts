import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

const currentMaterialEditorUrl = /\/authoring\/materials\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\?.*)?$/u;

test("trusted author creates a PostgreSQL draft and opens its current Preview", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto("/authoring/materials/new");
  expect(response?.status()).toBe(200);
  await completeProfileOnboardingIfPresent(page);
  await expect(page.getByRole("heading", { name: "Новый материал" })).toBeVisible();
  await expect(page.getByLabel("Адрес")).toHaveCount(0);

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
  await page.getByRole("option", { name: "Платформа" }).click();
  await page.getByRole("combobox", { name: "Формат" }).click();
  await page.getByRole("option", { name: "Руководство" }).click();
  await page.getByText("Full stack", { exact: true }).click();
  await page.getByText("Создание Platform Inside", { exact: true }).click();
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
  await expect(page.getByLabel("Адрес")).toHaveCount(0);
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(page.getByText("Версия", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Предпросмотр" })).toBeEnabled();

  await page.getByRole("button", { name: "Предпросмотр" }).click();
  await expect(page).toHaveURL(new RegExp(`/authoring/materials/.+/preview(?:\\?.*)?$`, "u"));
  await expect(page.getByRole("heading", { name: "Предпросмотр материала" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Current Preview без fake data", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Текущее сохранённое содержимое из PostgreSQL.")).toBeVisible();
  await expect(page.getByText("Руководство")).toBeVisible();
  await expect(page.getByText("Платформа")).toBeVisible();
  await expect(page.getByText("Full stack")).toBeVisible();
  await expect(page.getByText("Сохранённый черновик. Материал ещё не опубликован.")).toBeVisible();
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
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(page.getByText("Версия", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Topic", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Format", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Платформа", { exact: true })).toBeVisible();
  await expect(page.getByText("Руководство", { exact: true })).toBeVisible();
  await expect(page.getByText(/Все текущие Materials/u)).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Состояние публикации" }),
  ).toContainText("Опубликованные");
  await page.getByRole("searchbox", { name: "Поиск по названию, описанию или адресу" }).focus();
  await expect(
    page.getByRole("searchbox", { name: "Поиск по названию, описанию или адресу" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Состояние публикации" })).toBeFocused();

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

  await page.getByRole("link", { name: "Предпросмотр" }).click();
  await expect(page.getByRole("heading", { name: "Предпросмотр материала" })).toBeVisible();
  await expect(page.getByText("Reader verification checklist")).toBeVisible();
  await page.getByRole("link", { name: "К материалам" }).click();
  await expect(page).toHaveURL(listUrl);

  await page.getByRole("link", { name: "Редактировать" }).click();
  await expect(page.getByRole("heading", { name: "Как устроен Inside Platform" })).toBeVisible();
  await page.getByRole("button", { name: "Вернуться к материалам" }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByRole("link", { name: "Как устроен Inside Platform" })).toBeVisible();

  await page.getByRole("link", { name: "Новый материал" }).first().click();
  await expect(page.getByRole("heading", { name: "Новый материал" })).toBeVisible();
  await page.getByRole("button", { name: "Вернуться к материалам" }).click();
  await expect(page).toHaveURL(listUrl);
});

test("full-state Save is live and a stale editor preserves local input through lifecycle changes", async ({
  context,
  page,
}) => {
  const uniqueSuffix = String(Date.now());
  const initialTitle = `Mutable Material ${uniqueSuffix}`;
  const winnerTitle = `Mutable Material winner ${uniqueSuffix}`;
  const slug = `mutable-material-winner-${uniqueSuffix}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, initialTitle);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await expect(page.getByRole("button", { name: "Предпросмотр" })).toBeEnabled();
  const editorUrl = page.url();
  const stalePage = await context.newPage();
  await stalePage.goto(editorUrl);
  await expect(stalePage.getByRole("heading", { name: initialTitle })).toBeVisible();
  await expect(stalePage.getByText(/^v\d+$/u)).toHaveCount(0);

  await page.getByLabel("Название").fill(winnerTitle);
  await page.getByLabel("Название").press("Enter");
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();

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
    currentPreview.getByRole("heading", { name: winnerTitle, level: 1 }),
  ).toBeVisible();
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(localSummary);

  const currentEditorPromise = context.waitForEvent("page");
  await stalePage.getByRole("button", { name: "Открыть текущую" }).click();
  const currentEditor = await currentEditorPromise;
  await currentEditor.waitForLoadState();
  await expect(currentEditor.getByLabel("Название")).toHaveValue(
    winnerTitle,
  );
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(localSummary);

  await expect(page.getByLabel("Адрес")).toHaveCount(0);
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(page.getByText("Опубликован", { exact: true }).first()).toBeVisible();

  const publicPage = await context.newPage();
  await publicPage.goto(`/materials/${slug}`);
  await expect(
    publicPage.getByRole("heading", { name: winnerTitle, level: 1 }),
  ).toBeVisible();
  await expect(publicPage.getByText("Текущее сохранённое содержимое из PostgreSQL.")).toBeVisible();

  await page.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { name: "Материал не найден" })).toBeVisible();
});

test("trusted author publishes and unpublishes the same full state from the Materials list", async ({
  context,
  page,
}, testInfo) => {
  const title = `Lifecycle из списка ${String(Date.now())}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("Черновик", { exact: true })).toBeVisible();
  const deleteButton = row.getByRole("button", { name: "Удалить черновик" });
  await expect(deleteButton).toBeVisible();
  await captureLifecycleEvidence(page, testInfo, "live-lifecycle");
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog", { name: `Удалить «${title}»?` });
  await expect(deleteDialog).toBeVisible();
  await captureLifecycleEvidence(page, testInfo, "live-delete-confirmation");
  await deleteDialog.getByRole("button", { name: "Оставить черновик" }).click();
  await expect(deleteDialog).toBeHidden();

  await row.getByRole("button", { name: "Опубликовать" }).click();
  await expect(row.getByText("Опубликован", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(row.getByRole("button", { name: "Снять с публикации" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Удалить черновик" })).toHaveCount(0);

  await row.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(row.getByRole("button", { name: "Опубликовать" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Удалить черновик" })).toHaveCount(0);
});

test("trusted author cancels and confirms deletion of a never-published draft", async ({
  context,
  page,
}) => {
  const title = `Удаляемый черновик ${String(Date.now())}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  const openDelete = page.getByRole("button", { name: "Удалить черновик" });
  await openDelete.focus();
  await expect(openDelete).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Удалить «${title}»?` });
  await expect(dialog).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await openDelete.click();
  await dialog.getByRole("button", { name: "Оставить черновик" }).click();
  await expect(dialog).toBeHidden();

  await openDelete.click();
  await dialog.getByRole("button", { name: "Удалить безвозвратно" }).click();
  await expect(page).toHaveURL(/\/authoring\/materials(?:\?.*)?$/u);
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});

test("trusted author sees a typed not-found state for a missing current Preview", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto(
    "/authoring/materials/94000000-0000-4000-8000-000000000099/preview",
  );
  await completeProfileOnboardingIfPresent(page);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Предпросмотр не найден" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Повторить" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Вернуться в редактор" })).toBeVisible();
});

test("trusted author reorders a PostgreSQL playlist with keyboard controls", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto("/authoring/playlists");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/authoring\/playlists\/[0-9a-f-]+$/u);
  await expect(
    page.getByRole("heading", { name: "Создание Platform Inside", level: 1 }),
  ).toBeVisible();

  const items = page.getByRole("list", { name: "Материалы плейлиста" }).getByRole("listitem");
  await expect(items.nth(1)).toBeVisible();
  const firstTitle = await items.first().locator("p").first().innerText();
  const secondTitle = await items.nth(1).locator("p").first().innerText();
  const moveDown = items.first().getByRole("button", {
    name: `Опустить «${firstTitle}»`,
  });
  await moveDown.focus();
  await expect(moveDown).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Есть несохранённые изменения.")).toBeVisible();

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

  await page.getByRole("button", { name: "Сохранить порядок" }).click();
  await expect(page.getByText("Порядок сохранён.")).toBeVisible();
  await page.reload();
  await expect(items.first().locator("p").first()).toHaveText(secondTitle);
});

test("guest cannot reach the production Material editor", async ({ page }) => {
  const response = await page.goto("/authoring/materials/new");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Нет доступа к редактору" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Создать черновик" })).toHaveCount(0);
});

test("guest cannot reach the production playlist manager", async ({ page }) => {
  const response = await page.goto("/authoring/playlists");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Нет доступа к редактору" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Сохранить порядок" })).toHaveCount(0);
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

async function completeProfileOnboardingIfPresent(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Как к вам обращаться?" });
  const visible = await dialog
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  await dialog.getByLabel("Имя").fill("Full-stack author");
  await dialog.getByRole("button", { name: "Продолжить" }).click();
  await expect(dialog).toBeHidden();
}

async function fillPublishableDraft(page: Page, title: string) {
  await page.getByLabel("Название").fill(title);
  await page
    .getByLabel("Краткое описание")
    .fill("Full-state Save проходит через production Editor и Nest MaterialAuthoring.");
  await page.getByRole("combobox", { name: "Тема" }).click();
  await page.getByRole("option", { name: "Платформа" }).click();
  await page.getByRole("combobox", { name: "Формат" }).click();
  await page.getByRole("option", { name: "Руководство" }).click();
  await page
    .getByRole("textbox", { name: "Содержимое материала" })
    .fill("Текущее сохранённое содержимое из PostgreSQL.");
}

async function captureLifecycleEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(
    process.cwd(),
    "../../docs/evidence/issue-150",
  );
  await mkdir(evidenceDirectory, { recursive: true });
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: resolve(evidenceDirectory, `${name}-${viewport}.png`),
  });
}
