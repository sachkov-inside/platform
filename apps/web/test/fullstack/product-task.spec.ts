import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ownTaskSubmissionsSchema } from "@/features/product-task-submission/model/product-task-page";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { signInFullStack } from "../support/full-stack-session";

function taskFixture(): {
  readonly productSlug: string;
  readonly code: string;
} {
  const productSlug = process.env["FULLSTACK_TASK_PRODUCT_SLUG"];
  const code = process.env["FULLSTACK_TASK_CODE"];
  if (productSlug === undefined || code === undefined)
    throw new Error("Missing isolated Product Task fixture");
  return { productSlug, code };
}

/** Only the storage notice covers the page; Telegram stays in the header. */
async function dismissNotices(page: Page) {
  await expect(
    page.getByRole("dialog", { name: "Подключите Telegram" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
}

/** Seed a legacy form receipt to keep existing learner history covered after removing its UI. */
async function seedLegacySubmission(page: Page, code: string, note: string) {
  const historyResponse = await page.request.get(
    `/api/product-tasks/submissions?code=${encodeURIComponent(code)}`,
  );
  expect(historyResponse.ok()).toBe(true);
  const history = ownTaskSubmissionsSchema.parse(await historyResponse.json());
  const response = await page.request.post("/api/product-tasks/submissions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: {
      code,
      taskVersion: String(history.currentVersion),
      submissionKey: randomUUID(),
      note,
    },
  });
  expect(response.ok()).toBe(true);
  const receipt: unknown = await response.json();
  expect(receipt).toMatchObject({ kind: "submitted" });
  await page.reload();
}

test("a learner without Membership opens the agent-led workflow and still sees a legacy saved submission (#947)", async ({
  context,
  page,
}, testInfo) => {
  const { productSlug, code } = taskFixture();
  const note = `Сдача ${testInfo.project.name}: заявка создаётся.`;
  await signInFullStack(context, "NON_MEMBER");
  await page.goto(`/products/${productSlug}/programme`);
  await dismissNotices(page);
  const afterLesson = page.getByRole("list", {
    name: "Задания после урока «Synthetic task lesson»",
  });
  await afterLesson
    .getByRole("link", { name: "Синтетическое задание" })
    .click();
  await expect(page).toHaveURL(`/products/${productSlug}/tasks/${code}`);
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

  await expect(page.locator("[data-product-task-form]")).toHaveCount(0);
  await seedLegacySubmission(page, code, note);
  const mine = page
    .getByRole("region", { name: "Мои сдачи", exact: true })
    .locator("[data-own-submissions]");
  const submitted = mine.locator("[data-submission]").filter({ hasText: note });
  await submitted.getByText("Моя заметка", { exact: true }).click();
  await expect(submitted.getByText(note)).toBeVisible();
  await expect(submitted.getByText("Через форму")).toBeVisible();

  await page.reload();
  const restored = page
    .getByRole("region", { name: "Мои сдачи", exact: true })
    .locator("[data-own-submissions] [data-submission]")
    .filter({ hasText: note });
  await restored.getByText("Моя заметка", { exact: true }).click();
  await expect(restored.getByText(note)).toBeVisible();
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

  await page.goto(`/products/${productSlug}/programme`);
  await expect(
    page
      .locator(`[data-programme-task="${code}"]`)
      .locator("[data-task-submitted]"),
  ).toBeVisible();
});

test("an unknown task code answers with the task not-found page (#947)", async ({
  page,
}) => {
  const { productSlug } = taskFixture();
  await page.goto(`/products/${productSlug}/tasks/absent-task`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Задание не найдено" }),
  ).toBeVisible();
});

test("a practical Material reuses the real submission workspace without adding a programme Task row", async ({
  context,
  page,
}, testInfo) => {
  const { productSlug } = taskFixture();
  const slug = process.env["FULLSTACK_TASK_MATERIAL_SLUG"];
  const code = process.env["FULLSTACK_EMBEDDED_TASK_CODE"];
  if (slug === undefined || code === undefined)
    throw new Error("Missing embedded practice fixture");
  await signInFullStack(context, "NON_MEMBER");
  const returnTo = `/materials/${slug}?from=${encodeURIComponent(`/products/${productSlug}/programme`)}`;
  await page.goto(returnTo);
  await dismissNotices(page);
  await expect(page.locator("[data-reader-body]")).toContainText(
    "Урок перед заданием.",
  );
  const workspace = page.locator("#task-submit");
  await expect(
    workspace.getByRole("heading", { name: "Сдача задания" }),
  ).toBeVisible();
  await expect(workspace.locator("[data-agent-phrase]")).toContainText(code);
  await expect(workspace.locator("[data-product-task-form]")).toHaveCount(0);
  const note = `Embedded practice ${testInfo.project.name}`;
  await seedLegacySubmission(page, code, note);
  const attempt = workspace
    .locator("[data-submission]")
    .filter({ hasText: note });
  await attempt.getByText("Моя заметка", { exact: true }).click();
  await expect(attempt.getByText(note)).toBeVisible();
  await expect(page).toHaveURL(returnTo);
  await page.reload();
  await expect(page.locator("[data-reader-body]")).toContainText(
    "Урок перед заданием.",
  );
  await expect(
    page
      .getByRole("region", { name: "Мои сдачи", exact: true })
      .locator("[data-own-submissions]"),
  ).toContainText(note);
  const programme = page.getByRole("button", {
    name: "Вся программа",
    exact: true,
  });
  const mobileProgramme = await programme.isVisible();
  if (mobileProgramme) await programme.click();
  await expect(
    page.locator(
      `[data-course-step="material:${slug}"] [data-task-submitted="true"]:visible`,
    ),
  ).toHaveCount(1);
  if (mobileProgramme)
    await page.getByRole("button", { name: "Закрыть программу" }).click();
  await expect(page.locator(`[data-course-step="task:${code}"]`)).toHaveCount(
    0,
  );
  expect(
    (
      await new AxeBuilder({ page }).include("main").analyze()
    ).violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
