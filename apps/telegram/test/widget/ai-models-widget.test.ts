import { type Browser, type Page, chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { buildAiModelsWidgetHtml } from "../../scripts/ai-models-widget/build.js";
import {
  encodeAiModelsWidgetData,
  type AiModelsWidgetData,
} from "../../src/modules/ai-models/widget/ai-models-widget-wire.js";
import { type WidgetTheme, widgetPage } from "./trainer-widget-harness.js";

// The built ИИ-модели widget in Chromium with a stand-in TelegramWidget: the skeleton that asks
// for the first page, shows the bot's refusal and repeats the request. It proves the HTML the
// bot sends, not how a Telegram app draws it.

const COMING_SOON: AiModelsWidgetData = [
  "x",
  "Скоро здесь будет список моделей",
];

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/** Opens the widget with these answers queued for its first requests. */
async function openWidget(
  answers: readonly string[],
  width = 320,
  theme: WidgetTheme = "light",
): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width, height: 560 },
    colorScheme: theme,
  });
  await page.setContent(
    await widgetPage(buildAiModelsWidgetHtml(), {
      chatData: '["l","p",0]',
      theme,
      fixedFont: true,
      answers,
    }),
  );
  await page.waitForFunction(
    `widgetRequests.length > 0 && document.querySelector("#w").className === ""`,
  );
  return page;
}

// The page's own globals (the stand-in TelegramWidget and its queues) are reached with script
// text: they do not exist in the types of this Node.js project.
const requests = async (page: Page): Promise<string[]> =>
  z.array(z.string()).parse(await page.evaluate("widgetRequests"));
const text = (page: Page): Promise<string> => page.locator("#w").innerText();

describe("ИИ-модели widget skeleton", () => {
  it("asks for the first page of «Мощные» as soon as it starts and anchors its bottom", async () => {
    const page = await openWidget([encodeAiModelsWidgetData(COMING_SOON)]);
    try {
      expect(await requests(page)).toEqual(["3lp0"]);
      expect(await page.evaluate("widgetResizeAnchor")).toBe("bottom");
    } finally {
      await page.close();
    }
  });

  it("shows the bot's text under the title with a button that repeats the request", async () => {
    const page = await openWidget([
      encodeAiModelsWidgetData(COMING_SOON),
      encodeAiModelsWidgetData([
        "x",
        "Слишком часто. Повторите через несколько секунд.",
      ]),
    ]);
    try {
      expect(await text(page)).toBe(
        "ИИ-модели\nСкоро здесь будет список моделей\nПовторить",
      );

      await page.getByRole("button", { name: "Повторить" }).click();
      await page.waitForFunction(
        `widgetRequests.length > 1 && document.querySelector("#w").className === ""`,
      );

      expect(await requests(page)).toEqual(["3lp0", "3lp0"]);
      expect(await text(page)).toContain(
        "Слишком часто. Повторите через несколько секунд.",
      );
    } finally {
      await page.close();
    }
  });

  it.each([
    ["no answer in time", []],
    ["an answer it cannot read", ["{}"]],
    ["a screen it does not know yet", ['["l","p",0,1]']],
  ])("offers to repeat the request after %s", async (_name, answers) => {
    const page = await openWidget(answers);
    try {
      expect(await text(page)).toBe("ИИ-модели\nБот не ответил.\nПовторить");
    } finally {
      await page.close();
    }
  });

  it("takes no second press while a request is in flight", async () => {
    const page = await openWidget([encodeAiModelsWidgetData(COMING_SOON)]);
    try {
      // The next request stays unanswered, as while the bot is still working on it.
      await page.evaluate(
        "TelegramWidget.request = (data) => { widgetRequests.push(data); return new Promise(() => {}); }",
      );

      await page.evaluate("g('R'); g('R'); g('lp0')");

      expect(await requests(page)).toEqual(["3lp0", "3lp0"]);
    } finally {
      await page.close();
    }
  });

  it.each([
    [320, "light"],
    [320, "dark"],
    [390, "light"],
    [390, "dark"],
  ] as const)(
    "fits a %i px bubble in the %s theme without overflow",
    async (width, theme) => {
      const page = await openWidget(
        [encodeAiModelsWidgetData(COMING_SOON)],
        width,
        theme,
      );
      try {
        const root = await page.locator("#w").boundingBox();
        // The guide's target ceiling for every screen in a 320 px wide bubble.
        expect(root?.height).toBeLessThanOrEqual(560);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      } finally {
        await page.close();
      }
    },
  );
});
