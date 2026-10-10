// @ts-check
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { z } from "zod";

import { screenshotWholePage } from "../test/support/whole-page-screenshot.mjs";

const output = resolve(process.argv[2] ?? "../../.local/967-proof");
const base = process.argv[3] ?? "http://127.0.0.1:6017";
const commit = process.argv[4];
if (commit === undefined)
  throw new Error("Pass the exact proof commit as argument 4");
await mkdir(output, { recursive: true });
const indexResponse = await fetch(`${base}/index.json`);
if (!indexResponse.ok)
  throw new Error(`Storybook index: ${String(indexResponse.status)}`);
const index = z
  .object({
    entries: z.record(
      z.string(),
      z.object({ id: z.string(), title: z.string(), name: z.string() }),
    ),
  })
  .parse(await indexResponse.json());
/** @param {string} name */
function storyId(name) {
  const entry = Object.values(index.entries).find(
    (item) =>
      item.title === "Prototypes/967/Сдачи" && item.name.toLowerCase() === name,
  );
  if (entry === undefined) throw new Error(`Story not found: ${name}`);
  return entry.id;
}
const browser = await chromium.launch();
const expectedReport = [
  {
    requirement: "Новичок получает доступ к репозиториям через платформу.",
    status: "Подтверждено",
    level: "Обязательно",
    evidence:
      "README.md описывает выдачу; лог `grant.log` показывает ответ GitHub 201.",
    gap: "",
  },
  {
    requirement: "Доступ выдаёт только руководитель команды.",
    status: "Нарушение",
    level: "Обязательно · получено запуском",
    evidence: '<img src=x onerror="alert(1)"> Роль читается из запроса.',
    gap: "Роль приходит от клиента, сервер её не проверяет.",
  },
  {
    requirement: "Второй агент проверяет выдачу.",
    status: "Не проверено",
    level: "Дополнительно",
    evidence: "",
    gap: "Инструкции второго агента в репозитории нет.",
  },
];
/** @type {{scenario: string, width: number, violations: string[], screenshot: string}[]} */
const captures = [];
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      for (const scenario of [
        "A",
        "B",
        "C",
        "loading",
        "empty",
        "error",
        "denied",
      ]) {
        const variant = ["A", "B", "C"].includes(scenario) ? scenario : "A";
        const story = ["A", "B", "C"].includes(scenario)
          ? "comparison"
          : scenario;
        await page.goto(
          `${base}/iframe.html?id=${storyId(story)}&viewMode=story&variant=${variant}`,
        );
        await expect(
          page.getByRole("heading", { level: 1, name: "Сдачи" }),
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Варианты прототипа" }),
        ).toBeVisible();
        await page.evaluate("document.fonts.ready");
        expect(
          await page.evaluate(
            "document.documentElement.scrollWidth === document.documentElement.clientWidth",
          ),
        ).toBe(true);
        if (["A", "B", "C"].includes(scenario)) {
          const report = page
            .getByRole("article", { name: "Полная сдача: Онбординг команды" })
            .first();
          const criteria = report
            .getByRole("region", { name: "Полный отчёт" })
            .getByRole("list")
            .first()
            .getByRole("listitem");
          await expect(criteria).toHaveCount(expectedReport.length);
          for (const [position, criterion] of expectedReport.entries()) {
            const row = criteria.nth(position);
            for (const text of [
              criterion.requirement,
              criterion.status,
              criterion.level,
            ]) {
              await expect(row.getByText(text, { exact: true })).toBeVisible();
            }
            for (const [label, content] of [
              ["Доказательство", criterion.evidence],
              ["Пробел", criterion.gap],
            ]) {
              if (content === "") {
                await expect(
                  row.getByText(`${label}:`, { exact: true }),
                ).toHaveCount(0);
              } else {
                await expect(
                  row.getByText(`${label}: ${content}`, { exact: true }),
                ).toBeVisible();
              }
            }
          }
          await expect(page.locator("img[src=x]")).toHaveCount(0);
        }
        const a11y = await new AxeBuilder({ page }).analyze();
        const serious = a11y.violations.filter(
          (item) => item.impact === "serious" || item.impact === "critical",
        );
        expect(
          serious.map((item) => ({
            id: item.id,
            nodes: item.nodes.map((node) => node.target),
          })),
        ).toEqual([]);
        const screenshot = `${scenario}-${String(width)}.png`;
        await screenshotWholePage(page, { path: resolve(output, screenshot) });
        captures.push({
          scenario,
          width,
          violations: a11y.violations.map((item) => item.id),
          screenshot,
        });
      }
      await page.goto(
        `${base}/iframe.html?id=${storyId("comparison")}&viewMode=story&variant=A`,
      );
      await expect(
        page.getByRole("heading", { level: 1, name: "Сдачи" }),
      ).toBeVisible();
      const comment = page.getByRole("textbox", {
        name: "Комментарий для ученика",
      });
      await comment.fill("Проверку роли перенеси на сервер.");
      await comment.press("ArrowRight");
      await expect(page).toHaveURL(/variant=A/u);
      await page.getByRole("checkbox", { name: "Посмотрел автор" }).check();
      await page.getByRole("button", { name: "Сохранить отзыв" }).click();
      await expect(
        page.getByText(
          "Отзыв сохранён в памяти прототипа. На сайт он не отправлен.",
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: "Следующий вариант" }).click();
      await expect(page).toHaveURL(/variant=B/u);
      await expect(comment).toHaveValue("Проверку роли перенеси на сервер.");
      await page.keyboard.press("ArrowRight");
      await expect(page).toHaveURL(/variant=C/u);
      await page.getByRole("button", { name: "Следующий вариант" }).click();
      await expect(page).toHaveURL(/variant=A/u);
      await page
        .getByRole("combobox", { name: "Продукт" })
        .selectOption({ label: "AI Engineering" });
      await page
        .getByRole("combobox", { name: "Глава" })
        .selectOption({ label: "Глава 2. Заявки" });
      await expect(
        page.getByRole("article", { name: "Полная сдача: Заявки клиентов" }),
      ).toBeVisible();
      await expect(
        page.getByRole("article", { name: "Полная сдача: Онбординг команды" }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
  await writeFile(
    resolve(output, "proof.json"),
    JSON.stringify(
      {
        commit,
        base,
        browser: browser.version(),
        captures,
        interactions: [
          "three synthetic report criteria retain requirements, statuses, evidence and gaps as plain text",
          "feedback stays in memory across variants",
          "product/chapter filtering",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      commit,
      captures: captures.length,
      widths: [390, 1440],
      seriousOrCriticalViolations: 0,
      output,
    }),
  );
} finally {
  await browser.close();
}
