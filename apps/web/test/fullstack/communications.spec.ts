import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";

test("manages a funnel through the live BFF, Platform API and Telegram provider", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    process.env.FULLSTACK_COMMUNICATIONS !== "true",
    "Requires an isolated communications provider with sending disabled and a linked author fixture",
  );
  const session = process.env.FULLSTACK_LOGTO_SESSION;
  const baseURL = process.env.FULLSTACK_WEB_BASE_URL;
  if (!session || !baseURL)
    throw new Error("Missing communications proof session");
  await context.addCookies([
    {
      name:
        process.env.FULLSTACK_LOGTO_COOKIE_NAME ?? "logto_inside-web-fullstack",
      value: session,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const postName = `Funnel post ${testInfo.project.name} ${String(Date.now())}`;
  const invalidPostName = `${postName} invalid`;
  for (const text of [
    postName,
    `${invalidPostName} ${baseURL}/materials/missing-communications-proof`,
  ]) {
    const result = await page.request.post(
      `${baseURL}/api/communications/templates/save`,
      {
        headers: { origin: baseURL },
        multipart: {
          input: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedRevision: 0,
            payload: {
              templateId: crypto.randomUUID(),
              content: { type: "text", text, entities: [], buttons: [] },
            },
          }),
        },
      },
    );
    expect(await result.json()).toMatchObject({ kind: "ready" });
  }
  async function choose(group: Locator, title = postName, replace = false) {
    await group
      .getByRole("button", {
        name: replace
          ? "Заменить часть 1 из сохранённых постов"
          : "Добавить сохранённый пост",
        exact: true,
      })
      .click();
    await group
      .getByRole("button", { name: new RegExp(`^${title}`) })
      .first()
      .click();
    await group
      .getByRole("button", {
        name: replace
          ? "Заменить выбранную часть"
          : "Добавить в последовательность",
        exact: true,
      })
      .click();
  }
  await page.goto("/authoring/communications");
  await expect(
    page.getByRole("heading", { name: "Ваши воронки" }),
  ).toBeVisible();
  await page
    .getByText("Общее знакомство · один раз на человека", { exact: true })
    .click();
  if (
    await page
      .getByRole("button", { name: "Создать общее знакомство", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "Создать общее знакомство", exact: true })
      .click();
    await choose(
      page.getByRole("group", { name: "Части общего знакомства", exact: true }),
    );
    await page
      .getByRole("button", { name: "Сохранить общее знакомство", exact: true })
      .click();
    await expect(
      page.getByText(
        "Общее знакомство обновлено. Прежние получатели не получат его повторно.",
        { exact: true },
      ),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Создать воронку", exact: true })
    .click();
  const name = `Proof ${testInfo.project.name} ${String(Date.now())}`;
  await page.getByLabel("Название воронки", { exact: true }).fill(name);
  const entry = page.getByRole("group", {
    name: "Непосредственный ответ по ссылке",
    exact: true,
  });
  await choose(entry);
  await page.getByRole("button", { name: "Добавить шаг", exact: true }).click();
  const step = page.getByRole("region", { name: "Шаг 1", exact: true });
  await choose(step);
  await page
    .getByRole("button", { name: "Добавить источник", exact: true })
    .click();
  await page.getByLabel("Название источника", { exact: true }).fill("Проверка");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page.getByText("Черновик сохранён. Опубликованные сообщения не изменены.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Опубликованная версия: ещё нет", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Проверить изменения и охват", exact: true })
    .click();
  await expect(page.getByText("Новых шагов: 1", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Опубликовать воронку", exact: true })
    .click();
  await expect(
    page.getByText(
      "Воронка опубликована. Отправленные шаги не будут повторены.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Приостановить", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Возобновить", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Возобновить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Приостановить", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: `Открыть ${name}`, exact: true })
    .click();
  await expect(
    page.getByLabel("Название воронки", { exact: true }),
  ).toHaveValue(name);
  // A promised Platform target is checked by Materials before publication.
  await choose(entry, invalidPostName, true);
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page.getByText("Черновик сохранён. Опубликованные сообщения не изменены.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Проверить изменения и охват", exact: true })
    .click();
  await expect(
    page.getByText("Публикация недоступна: проверьте материалы и серии.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Опубликовать воронку", exact: true }),
  ).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include("#authoring-content").analyze())
      .violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Название воронки", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", {
      name: "Стандартная воронка для обычного запуска бота",
    }),
  ).toBeFocused();
  await mkdir("../../ci-artifacts/308", { recursive: true });
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.querySelector("main")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `../../ci-artifacts/308/live-${testInfo.project.name}.png`,
  });
});
