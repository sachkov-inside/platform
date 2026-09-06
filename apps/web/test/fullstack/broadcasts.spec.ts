import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";

// Other full-stack suites have no Telegram contract fixture.
test.skip(
  process.env.COMMUNICATIONS_PROVIDER_URL === undefined,
  "Run through smoke:communications",
);

test("author creates, previews, launches, pauses/resumes/cancels and reads analytics through real BFF/Nest", async ({
  page,
  context,
}, testInfo) => {
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const session = process.env.FULLSTACK_LOGTO_SESSION;
  const baseUrl = process.env.FULLSTACK_WEB_BASE_URL;
  const provider = process.env.COMMUNICATIONS_PROVIDER_URL;
  if (!cookieName || !session || !baseUrl || !provider)
    throw new Error("Run pnpm smoke:communications with its isolated fixtures");
  await context.addCookies([
    {
      name: cookieName,
      value: session,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/authoring/communications");
  await expect(
    page.getByRole("heading", { name: "Воронки Telegram", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Рассылки и аналитика", exact: true })
    .click();
  await expect(page).toHaveURL(/\/authoring\/communications\/broadcasts$/);
  await expect(
    page.getByRole("link", { name: "Воронки Telegram", exact: true }).first(),
  ).toHaveAttribute("href", "/authoring/communications");
  const summary: unknown = await (
    await page.request.get("/api/communications/statistics")
  ).json();
  expect(JSON.stringify(summary)).not.toContain('"kind":"error"');
  await expect(
    page.getByText("Переходов по ссылкам", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Новая рассылка" }).click();
  await page
    .getByRole("textbox", { name: "Текст", exact: true })
    .fill("Тестовая рассылка browser parity");
  await page
    .getByRole("radio", { name: "Участники выбранных воронок" })
    .check();
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Проверьте содержание" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Текст", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "Текст", exact: true }),
  ).toHaveValue("Тестовая рассылка browser parity");
  await page
    .getByRole("checkbox", { name: "Тестовая инженерная практика" })
    .check();
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Предпросмотр сообщения" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(
    page.getByRole("button", { name: "Запустить сейчас" }),
  ).toBeEnabled();
  await mkdir("../../ci-artifacts/communications", { recursive: true });
  await page.locator("main").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: `../../ci-artifacts/communications/${testInfo.project.name}-editor.png`,
    fullPage: true,
  });
  const editor = page.getByRole("region", { name: "Рассылка · Черновик" });
  const identifier = editor.locator("summary");
  await identifier.focus();
  await page.keyboard.press("Enter");
  await expect(editor.locator("details")).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("textbox", { name: "Текст", exact: true }),
  ).toBeFocused();
  await identifier.click();
  await editor.locator("h2").evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
  await page.screenshot({
    path: `../../ci-artifacts/communications/${testInfo.project.name}-editor-top.png`,
  });
  await editor
    .getByText("Время отправки", { exact: false })
    .evaluate((element) => {
      element.scrollIntoView({ block: "start" });
    });
  await page.screenshot({
    path: `../../ci-artifacts/communications/${testInfo.project.name}-editor-settings.png`,
  });
  const editorFailures = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze()
  ).violations;
  expect(editorFailures).toEqual([]);
  await page.getByRole("button", { name: "Запустить сейчас" }).click();
  await expect(
    page.getByRole("heading", { name: "Рассылка · Отправляется" }),
  ).toBeVisible();
  await expect(page.getByText("Получателей в снимке: 2.")).toBeVisible();
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Рассылка · На паузе" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Возобновить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Рассылка · Отправляется" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отменить рассылку" }).click();
  await expect(
    page.getByRole("heading", { name: "Рассылка · Отменена" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "История входов", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "История входов контакта" }),
  ).toContainText("Тестовый ролик");
  const captured: unknown = await (
    await page.request.get(`${provider}/captured`)
  ).json();
  const operations = z
    .array(
      z.object({
        operation: z.string(),
        operationId: z.guid(),
        actor: z.object({ accountRef: z.string().optional() }).optional(),
      }),
    )
    .parse(captured);
  expect(
    operations.some(
      (operation) =>
        operation.operation === "broadcasts.launch" &&
        operation.actor?.accountRef === "synthetic-author",
    ),
  ).toBe(true);
  expect(
    operations.some(
      (operation) => operation.operation === "templates.testSend",
    ),
  ).toBe(false);
  const failures = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(failures).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
  await mkdir("../../ci-artifacts/communications", { recursive: true });
  await page.screenshot({
    path: `../../ci-artifacts/communications/${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.locator("#analytics-title").evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
  await page.screenshot({
    path: `../../ci-artifacts/communications/${testInfo.project.name}-analytics.png`,
  });
  await page
    .getByRole("heading", { name: "Контакты и источники входа" })
    .evaluate((element) => {
      element.scrollIntoView({ block: "start" });
    });
  await page.screenshot({
    path: `../../ci-artifacts/communications/${testInfo.project.name}-contacts.png`,
  });
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Закрыть историю" }),
    ).toBeVisible();
  }
  const redirect = await page.request.get(
    `/communications/visit?token=${"a".repeat(43)}`,
    { maxRedirects: 0 },
  );
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe(
    "https://inside.test/materials/test-guide",
  );
  const anonymous = await context.browser()?.newContext();
  if (!anonymous) throw new Error("Missing browser");
  const denied = await anonymous.request.post(
    `${baseUrl}/api/communications/broadcasts/launch`,
    { headers: { origin: baseUrl }, multipart: { input: "{}" } },
  );
  expect(denied.status()).toBe(401);
  await anonymous.close();
});
