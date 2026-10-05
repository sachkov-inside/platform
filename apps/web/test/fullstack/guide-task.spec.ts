import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { signInFullStack } from "../support/full-stack-session";

function taskFixture(): { readonly guideSlug: string; readonly code: string } {
  const guideSlug = process.env["FULLSTACK_TASK_GUIDE_SLUG"];
  const code = process.env["FULLSTACK_TASK_CODE"];
  if (guideSlug === undefined || code === undefined)
    throw new Error("Missing isolated Guide Task fixture");
  return { guideSlug, code };
}

/** The member session greets with the Telegram and storage notices; they cover the page. */
async function dismissNotices(page: Page) {
  await page
    .getByRole("button", { name: "Закрыть подключение Telegram" })
    .click();
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
}

test("a learner without Membership reads a free task from the programme, submits it through the form and finds it in «Мои сдачи» (#947)", async ({
  context,
  page,
}, testInfo) => {
  const { guideSlug, code } = taskFixture();
  const note = `Сдача ${testInfo.project.name}: заявка создаётся.`;
  await signInFullStack(context, "NON_MEMBER");
  await page.goto(`/products/${guideSlug}/programme`);
  await dismissNotices(page);
  const afterLesson = page.getByRole("list", {
    name: "Задания после урока «Synthetic task lesson»",
  });
  await afterLesson
    .getByRole("link", { name: "Синтетическое задание" })
    .click();
  await expect(page).toHaveURL(`/products/${guideSlug}/tasks/${code}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Синтетическое задание" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Обязательно" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Дополнительно" }),
  ).toBeVisible();
  await expect(
    page.getByText(`Проверь моё задание ${code} через учебный MCP`, {
      exact: false,
    }),
  ).toBeVisible();

  await page.getByText("Нет агента с MCP? Сдать через форму").click();
  const form = page.locator("[data-guide-task-form]");
  await form.getByLabel(/Заметка для автора/u).fill(note);
  await form.getByRole("button", { name: "Отправить сдачу" }).click();
  await expect(
    form.getByText("Сдача отправлена. Она появилась в «Моих сдачах»."),
  ).toBeVisible();
  const mine = page.locator("[data-own-submissions]");
  await expect(mine.getByText(note)).toBeVisible();
  await expect(mine.getByText("Через форму").first()).toBeVisible();
  await expect(mine.getByText("Версия требований 1").first()).toBeVisible();

  await page.reload();
  await expect(
    page.locator("[data-own-submissions]").getByText(note),
  ).toBeVisible();
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  const evidence = await prepareEvidenceDirectory("issue-947");
  await page.screenshot({
    path: resolve(evidence, `task-page-${testInfo.project.name}.png`),
    animations: "disabled",
    fullPage: false,
  });

  await page.goto(`/products/${guideSlug}/programme`);
  await expect(
    page
      .locator(`[data-programme-task="${code}"]`)
      .locator("[data-task-submitted]"),
  ).toBeVisible();
});

test("an unknown task code answers with the task not-found page (#947)", async ({
  page,
}) => {
  const { guideSlug } = taskFixture();
  await page.goto(`/products/${guideSlug}/tasks/absent-task`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Задание не найдено" }),
  ).toBeVisible();
});
