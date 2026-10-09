import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

for (const state of [
  "unanswered",
  "correct",
  "incorrect",
  "dont-know",
  "all-explanations",
] as const) {
  test(`Storybook quiz A: ${state}`, async ({ page }, testInfo) => {
    await page.goto(
      `http://localhost:6006/iframe.html?id=pages-material-reader-quiz--${state}&viewMode=story`,
    );
    const quiz = page.locator("[data-material-quiz]");
    await expect(
      quiz.getByRole("heading", { name: "Проверьте понимание" }),
    ).toBeVisible();
    if (state === "correct")
      await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
    if (state === "incorrect")
      await expect(
        quiz.getByText("Пока неверно", { exact: true }),
      ).toBeVisible();
    if (state === "dont-know")
      await expect(
        quiz.getByRole("link", { name: "Повторить раздел" }),
      ).toBeVisible();
    if (state === "all-explanations")
      await expect(
        quiz.getByRole("heading", { name: "Разбор всех вариантов" }),
      ).toBeVisible();
    if (state === "unanswered") {
      await expect(quiz).not.toContainText("Неверно.");
      await expect(quiz).not.toContainText("Верно.");
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth ===
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include("[data-material-quiz]").analyze())
        .violations,
    ).toEqual([]);
    if (process.env["CAPTURE_EVIDENCE"] === "1") {
      const directory = resolve("../../docs/evidence/issue-1283");
      await mkdir(directory, { recursive: true });
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await screenshotWholePage(page, {
        animations: "disabled",
        path: resolve(
          directory,
          `storybook-${state}-${testInfo.project.name}.png`,
        ),
      });
    }
    if (state === "unanswered") {
      const first = quiz.getByRole("button", { name: /1\. Форма написана/u });
      await first.focus();
      await page.keyboard.press("Enter");
      await expect(
        quiz.getByText("Пока неверно", { exact: true }),
      ).toBeVisible();
      await quiz.getByRole("button", { name: "Ответить ещё раз" }).click();
      await expect(first).toBeFocused();
      const second = quiz.getByRole("button", { name: /2\. После отправки/u });
      await second.focus();
      await page.keyboard.press("Space");
      await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
      await quiz.getByRole("button", { name: "Не знаю" }).click();
      await quiz.getByRole("link", { name: "Повторить раздел" }).click();
      await expect(
        page.locator('[id="проверяемый-результат"]'),
      ).toBeInViewport();
      await page.reload();
      await expect(page.locator("[data-material-quiz]")).not.toContainText(
        "Неверно.",
      );
    }
  });
}
