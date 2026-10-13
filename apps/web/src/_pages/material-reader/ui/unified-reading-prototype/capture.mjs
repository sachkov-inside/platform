// @ts-check
// Bounded visual evidence, not an application test suite. All resources belong to this process.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { screenshotWholePage } from "../../../../../test/support/whole-page-screenshot.mjs";

const output = resolve(process.argv[2] ?? "docs/evidence/issue-1414/confirmed");
const combined = process.argv.includes("--combined-b");
const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const codeTree = execFileSync(
  "git",
  [
    "rev-parse",
    "HEAD:apps/web/src/_pages/material-reader/ui/unified-reading-prototype",
  ],
  { encoding: "utf8" },
).trim();
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const records = [];
try {
  const page = await browser.newPage();
  for (const variant of combined ? ["B"] : ["A", "B", "C"]) {
    for (const width of [1440, 390]) {
      for (const [label, step] of [
        ["guide", "inside-content-aie-ch1-project-setup"],
        ["task", "aie-ch1-harness"],
      ]) {
        await page.setViewportSize({
          width,
          height: width === 1440 ? 900 : 844,
        });
        await page.goto(
          `http://127.0.0.1:6207/iframe.html?id=prototypes-unified-guide-task-reading--playground&viewMode=story&variant=${variant}&step=${step}`,
        );
        await expect(page.locator("article[data-step]")).toHaveAttribute(
          "data-step",
          step,
        );
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => {
          const article = document.querySelector("article[data-step]");
          const prose = article?.querySelector('[class*="body"] > p');
          const heading = article?.querySelector("h1");
          return {
            width: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
            articleWidth: article?.getBoundingClientRect().width,
            titleSize:
              heading === null || heading === undefined
                ? ""
                : getComputedStyle(heading).fontSize,
            proseSize:
              prose === null || prose === undefined
                ? ""
                : getComputedStyle(prose).fontSize,
            lineHeight:
              prose === null || prose === undefined
                ? ""
                : getComputedStyle(prose).lineHeight,
          };
        });
        expect(metrics.scroll).toBe(metrics.width);
        records.push({ variant, label, ...metrics });
        if (variant === (combined ? "B" : "A") && label === "guide") {
          for (const focus of ["overview", "brief"]) {
            await page.locator(`figure[data-focus="${focus}"]`).screenshot({
              path: resolve(output, `${variant}-guide-${width}-${focus}.png`),
              style:
                '[aria-label="Управление прототипом"], .public-header, .mobile-navigation, a[href="#app:content"] { visibility: hidden; }',
            });
          }
          await page.evaluate(() => {
            window.scrollTo(0, 0);
            document
              .querySelector("[data-application-content]")
              ?.scrollTo(0, 0);
          });
          console.log(
            `Overview/focus captures ready: ${variant} guide ${width}`,
          );
        }
        await screenshotWholePage(page, {
          path: resolve(output, `${variant}-${label}-${width}-whole.png`),
        });
        // Viewport regions remain readable without opening a very tall image.
        await page.screenshot({
          path: resolve(output, `${variant}-${label}-${width}-top.png`),
        });
        if (label === "task") {
          await page.locator("article h3").first().scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `${variant}-task-${width}-body.png`),
          });
          await page.locator("#pilot-submit").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `${variant}-task-${width}-submission.png`),
          });
        }
        if (combined) {
          await page
            .getByRole("navigation", { name: "Соседние шаги программы" })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `B-${label}-${width}-footer.png`),
          });
        }
      }
    }
  }
  if (combined) await confirmCombined(page);
  await writeFile(
    resolve(output, "metrics.json"),
    JSON.stringify({ codeCommit, codeTree, records }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}

/** @param {import("@playwright/test").Page} page */
async function confirmCombined(page) {
  const interactions = [];
  const mutations = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
      mutations.push({ method: request.method(), url: request.url() });
  });
  for (const { width, enlarged } of [
    { width: 720, enlarged: false },
    { width: 320, enlarged: false },
    { width: 390, enlarged: true },
  ]) {
    for (const [label, step] of [
      ["guide", "inside-content-aie-ch1-project-setup"],
      ["task", "aie-ch1-harness"],
    ]) {
      await page.setViewportSize({ width, height: 844 });
      await open(step);
      await page.evaluate(async (enlarged) => {
        if (enlarged) document.documentElement.style.fontSize = "200%";
        await Promise.allSettled(
          document.getAnimations().map((animation) => animation.finished),
        );
      }, enlarged);
      const metrics = await page.evaluate(() => {
        const actions = [
          ...document.querySelectorAll(
            '[class*="readingMeta"] button, [class*="readingMeta"] a',
          ),
        ].map((action) => {
          const rect = action.getBoundingClientRect();
          const target = getComputedStyle(action, "::after");
          return {
            label: action.getAttribute("aria-label") ?? action.textContent,
            visibleWidth: rect.width,
            visibleHeight: rect.height,
            targetWidth:
              rect.width - parseFloat(target.left) - parseFloat(target.right),
            targetHeight:
              rect.height - parseFloat(target.top) - parseFloat(target.bottom),
          };
        });
        return {
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          actions,
          clipped: [
            ...document.querySelectorAll(
              "article p, article h1, article h2, article h3, figure strong, figure span",
            ),
          ]
            .filter(
              (element) =>
                !element.classList.contains("sr-only") &&
                element.scrollWidth > element.clientWidth + 1,
            )
            .map((element) => element.textContent),
        };
      });
      expect(metrics.scroll).toBe(metrics.width);
      expect(metrics.clipped).toEqual([]);
      for (const action of metrics.actions) {
        expect(action.targetWidth).toBeGreaterThanOrEqual(44);
        expect(action.targetHeight).toBeGreaterThanOrEqual(44);
      }
      records.push({ variant: "B", label, enlarged, ...metrics });
      await screenshotWholePage(page, {
        path: resolve(
          output,
          `B-${label}-${width}-${enlarged ? "text200" : "narrow"}-whole.png`,
        ),
      });
      await page.screenshot({
        path: resolve(
          output,
          `B-${label}-${width}-${enlarged ? "text200" : "narrow"}.png`,
        ),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await open("inside-content-aie-ch1-project-setup");
  const selector = page.getByRole("combobox", { name: "Выбрать главу" });
  await selector.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { selected: true })).toContainText(
    "1.",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.screenshot({ path: resolve(output, "B-guide-1440-selector.png") });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(selector).toContainText("2.");
  await expect(page.locator("article[data-step]")).not.toHaveAttribute(
    "data-step",
    "inside-content-aie-ch1-project-setup",
  );
  await selector.click();
  await page.getByRole("option", { name: /^1\./ }).click();
  await expect(selector).toContainText("1.");
  await selector.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(selector).toBeFocused();
  interactions.push({
    customSelector: "selected state; keyboard change; Escape restores focus",
  });
  await open("inside-content-aie-ch1-project-setup");
  const anchors = await page
    .locator("article h2[id], article h3[id]")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        title: element.textContent,
        id: element.id,
      })),
    );
  const programme = page.getByRole("button", {
    name: "Вся программа",
    exact: true,
  });
  await programme.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.getByRole("dialog").locator('a[class*="step"]').count(),
  ).toBe(34);
  await page.keyboard.press("Escape");
  await expect(programme).toBeFocused();
  const neighbours = page.getByRole("navigation", {
    name: "Соседние шаги программы",
  });
  await neighbours.getByRole("link", { name: /^Следующий шаг:/ }).click();
  await expect(page.locator("article[data-step]")).toHaveAttribute(
    "data-step",
    "aie-ch1-harness",
  );
  await expect(page.locator("article[data-step]")).toBeFocused();
  expect(
    await page.getByRole("button", { name: /закладку|изучено/i }).count(),
  ).toBe(0);
  await neighbours.getByRole("link", { name: /^Следующий шаг:/ }).click();
  await expect(page.locator("article[data-step]")).toHaveAttribute(
    "data-step",
    "inside-content-aie-ch1-pipeline",
  );
  await neighbours.getByRole("link", { name: /^Предыдущий шаг:/ }).click();
  await expect(page.locator("article[data-step]")).toHaveAttribute(
    "data-step",
    "aie-ch1-harness",
  );
  await page.goBack();
  await expect(page.locator("article[data-step]")).toHaveAttribute(
    "data-step",
    "inside-content-aie-ch1-pipeline",
  );
  interactions.push({
    guideAnchors: anchors,
    keyboardDialog: "34 steps; Escape restores focus",
    sequence: "guide/task/pipeline/task",
    browserBack: "pipeline",
    taskReadingControls: "absent",
  });
  for (const scenario of [
    "ready",
    "history",
    "unavailable",
    "version",
    "closed",
    "expired",
  ]) {
    await open("aie-ch1-harness", scenario);
    await page
      .getByText("Нет агента с MCP? Сдать через форму", { exact: true })
      .click();
    const form = page.locator("[data-demo-form]");
    await form
      .locator('[name="note"]')
      .fill("Proof confirmation: local-memory submission.");
    if (scenario === "closed")
      await expect(
        form.getByRole("button", { name: "Отправить сдачу" }),
      ).toBeDisabled();
    else if (scenario === "history") {
      await expect(page.locator("#pilot-mine")).toContainText(
        "Посмотрел автор",
      );
      await expect(page.locator("#pilot-mine")).toContainText(
        "Автор ещё не смотрел.",
      );
    } else {
      await form.getByRole("button", { name: "Отправить сдачу" }).click();
      if (scenario === "ready") {
        await expect(page.locator("#pilot-mine")).toContainText(
          "Proof confirmation: local-memory submission.",
        );
        await expect(page.locator("#pilot-mine")).toContainText(
          "Версия требований 2",
        );
      } else {
        await expect(form.getByRole("alert")).not.toBeEmpty();
        await expect(form.locator('[name="note"]')).toHaveValue(
          "Proof confirmation: local-memory submission.",
        );
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(await page.evaluate(() => document.documentElement.clientWidth));
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(output, `B-task-1440-form-${scenario}.png`),
    });
    if (scenario === "ready" || scenario === "history") {
      await page.locator("#pilot-mine").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(output, `B-task-1440-history-${scenario}.png`),
      });
    }
    interactions.push({ scenario, result: "passed" });
  }
  expect(mutations).toEqual([]);
  await writeFile(
    resolve(output, "interactions.json"),
    JSON.stringify(
      { codeCommit, codeTree, interactions, outboundMutations: mutations },
      null,
      2,
    ) + "\n",
  );

  async function open(step, scenario = "ready") {
    await page.goto(
      `http://127.0.0.1:6207/iframe.html?id=prototypes-unified-guide-task-reading--playground&viewMode=story&step=${step}&scenario=${scenario}`,
    );
    await expect(page.locator("article[data-step]")).toHaveAttribute(
      "data-step",
      step,
    );
    await expect(
      page.getByRole("region", { name: "Управление прототипом" }),
    ).toContainText("Прототип B");
    await page.evaluate(() => document.fonts.ready);
  }
}
