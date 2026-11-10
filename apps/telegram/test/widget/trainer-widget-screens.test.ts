import { type Browser, type Page, chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  TELEGRAM_WIDGET_MAX_HEIGHT_PX,
  TRAINER_EXPLANATION_MAX_CHARS,
  TRAINER_OPTIONS_TOTAL_MAX_CHARS,
  TRAINER_QUESTION_MAX_CHARS,
  TRAINER_RATING_NAME_MAX_CHARS,
  TRAINER_RATING_ROWS_MAX,
  TRAINER_RESULT_COMMENT_MAX_CHARS,
  TRAINER_RESULT_TITLE_MAX_CHARS,
  TRAINER_STAT_LINE_MAX_CHARS,
  TRAINER_TOPIC_NAME_MAX_CHARS,
  TRAINER_TOPICS_MAX,
  TRAINER_WIDGET_CHECKED_WIDTHS_PX,
  TRAINER_WIDGET_TARGET_HEIGHT_PX,
} from "../../src/modules/trainer/widget/trainer-widget-limits.js";
import {
  type TrainerExplanationData,
  type TrainerHomeData,
  type TrainerQuestionData,
  type TrainerWidgetData,
  encodeTrainerWidgetData,
  parseTrainerWidgetRequest,
} from "../../src/modules/trainer/widget/trainer-widget-wire.js";
import {
  type WidgetPageOptions,
  realisticText,
  splitLength,
  trainerWidgetPage,
  wideText,
} from "./trainer-widget-harness.js";

// The built widget in Chromium with a stand-in TelegramWidget. It proves layout and behaviour
// of the HTML the bot sends; it does not prove how a Telegram app draws it (#2002 does).
// Every text is synthetic filler of the exact limit length.

type Filler = (length: number, seed?: number) => string;

const home: TrainerHomeData = ["h", 365, 5, 5, 0];

function topics(text: Filler): TrainerWidgetData {
  return [
    "t",
    Array.from({ length: TRAINER_TOPICS_MAX }, (_, index) => [
      `topic${String(index)}`,
      text(TRAINER_TOPIC_NAME_MAX_CHARS, index),
      20,
      20,
    ]),
  ];
}
/** The tallest question: the longest texts, four options and the «Ответить» button. */
function question(text: Filler, reviewMask?: number): TrainerQuestionData {
  const options = splitLength(TRAINER_OPTIONS_TOTAL_MAX_CHARS, 4).map(
    (length, index) => text(length, index),
  );
  const data = [
    "q",
    "1a2b3c",
    text(TRAINER_TOPIC_NAME_MAX_CHARS),
    text(TRAINER_QUESTION_MAX_CHARS),
    options,
    1,
    "1010",
    10,
  ] as const;
  return reviewMask === undefined ? data : [...data, reviewMask];
}
/** The tallest explanation: two wrong picks and two missed correct options keep all four. */
function explanation(text: Filler): TrainerExplanationData {
  return [
    "e",
    0,
    0b0011,
    0b1100,
    text(TRAINER_EXPLANATION_MAX_CHARS, 2),
    "10100",
    10,
    text(TRAINER_STAT_LINE_MAX_CHARS, 3),
  ];
}
const result = (text: Filler): TrainerWidgetData => [
  "r",
  text(TRAINER_RESULT_TITLE_MAX_CHARS),
  10,
  10,
  text(TRAINER_RESULT_COMMENT_MAX_CHARS, 1),
  10,
  365,
  9_999,
  1,
];
const progress = (text: Filler): TrainerWidgetData => [
  "p",
  9_999,
  365,
  9_999,
  Array.from(
    { length: TRAINER_TOPICS_MAX },
    (_, index) =>
      [text(TRAINER_TOPIC_NAME_MAX_CHARS, index), 20, 20, 100] as const,
  ),
];
const rating = (text: Filler, shown: 0 | 1 = 1): TrainerWidgetData => [
  "l",
  0,
  shown,
  Array.from({ length: TRAINER_RATING_ROWS_MAX }, (_, index) => [
    index === 7 ? 99_999 : index + 1,
    text(TRAINER_RATING_NAME_MAX_CHARS, index),
    99_999,
    index === 7 ? 1 : 0,
  ]),
];
const failure: TrainerWidgetData = ["x", realisticText(120)];

/** How to reach a screen from home: the taps and the bot's answer to each tap's request. */
interface Route {
  readonly name: string;
  readonly steps: (
    text: Filler,
  ) => readonly (readonly [button: string, answer?: TrainerWidgetData])[];
}
const routes: readonly Route[] = [
  { name: "home", steps: () => [] },
  { name: "topics", steps: (text) => [["Тренировка по теме", topics(text)]] },
  { name: "question", steps: (text) => [["Проверить себя", question(text)]] },
  {
    name: "answered question",
    steps: (text) => [["Вопрос дня", question(text, 0b1100)]],
  },
  {
    name: "explanation",
    steps: (text) => [
      ["Проверить себя", question(text)],
      ["Не знаю", explanation(text)],
    ],
  },
  { name: "round result", steps: (text) => [["Проверить себя", result(text)]] },
  { name: "Progress", steps: (text) => [["Прогресс", progress(text)]] },
  { name: "Rating", steps: (text) => [["Рейтинг", rating(text)]] },
  {
    name: "Rating before consent",
    steps: (text) => [["Рейтинг", rating(text, 0)]],
  },
  { name: "bot refusal", steps: () => [["Прогресс", failure]] },
  { name: "no answer", steps: () => [["Прогресс"]] },
];

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

async function openWidget(
  width: number,
  options: Partial<WidgetPageOptions> = {},
): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    colorScheme: options.theme ?? "light",
  });
  await page.setContent(
    await trainerWidgetPage({ chatData: JSON.stringify(home), ...options }),
  );
  return page;
}

/** Taps a button and waits until the widget has drawn the bot's answer to that tap. */
async function tap(
  page: Page,
  button: string,
  answer?: TrainerWidgetData,
): Promise<void> {
  const sent = await requests(page);
  if (answer) await queueAnswer(page, encodeTrainerWidgetData(answer));
  await buttonNamed(page, button).click();
  await page.waitForFunction(
    `widgetRequests.length > ${String(sent.length)} && document.querySelector("#w").className === ""`,
  );
}

// The page's own globals (the stand-in TelegramWidget and its queues) are reached with script
// text: they do not exist in the types of this Node.js project.
const queueAnswer = (page: Page, text: string): Promise<unknown> =>
  page.evaluate(`widgetAnswers.push(${JSON.stringify(text)})`);

/** A button whose text starts with `name`: a card's name continues with its hint. */
const buttonNamed = (page: Page, name: string) =>
  page.getByRole("button", {
    name: new RegExp(
      `^${name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`,
    ),
  });

const requests = async (page: Page): Promise<string[]> =>
  z.array(z.string()).parse(await page.evaluate("widgetRequests"));

async function reach(page: Page, route: Route, text: Filler): Promise<void> {
  for (const [button, answer] of route.steps(text))
    await tap(page, button, answer);
}

interface Layout {
  readonly height: number;
  readonly fontSize: string;
  /** Elements whose box leaves the bubble sideways. */
  readonly overflowing: string[];
  readonly pageWidth: number;
}
const layout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#w");
    if (!root) throw new Error("The widget root is missing");
    const width = document.documentElement.clientWidth;
    return {
      height: document.body.offsetHeight,
      fontSize: root.style.fontSize,
      pageWidth: document.documentElement.scrollWidth,
      overflowing: [...root.querySelectorAll<HTMLElement>("*")]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.left < 0 || box.right > width + 0.5;
        })
        .map((element) => element.outerHTML.slice(0, 80)),
    };
  });

describe("trainer widget screens in a browser", () => {
  describe.each(TRAINER_WIDGET_CHECKED_WIDTHS_PX)(
    "in a %i px bubble with texts at the limits",
    (width) => {
      it.each(routes)(
        "$name is not taller than 560 px at the default text size and stays inside the bubble",
        async (route) => {
          const page = await openWidget(width);
          await reach(page, route, realisticText);

          const measured = await layout(page);

          expect(measured.overflowing).toEqual([]);
          expect(measured.pageWidth).toBe(width);
          expect(measured.fontSize).toBe("");
          expect(measured.height).toBeLessThanOrEqual(
            TRAINER_WIDGET_TARGET_HEIGHT_PX,
          );
          expect(TRAINER_WIDGET_TARGET_HEIGHT_PX).toBe(560);
        },
      );
    },
  );

  describe.each([
    ["the widest letters", { textSizePx: 15 }, wideText],
    ["the largest text size setting", { textSizePx: 23 }, realisticText],
  ] as const)("in a 320 px bubble with %s", (_name, options, text) => {
    it.each(routes)(
      "$name gets smaller text instead of being clipped",
      async (route) => {
        const page = await openWidget(320, options);
        await reach(page, route, text);

        const measured = await layout(page);

        expect(measured.overflowing).toEqual([]);
        expect(measured.pageWidth).toBe(320);
        expect(measured.height).toBeLessThanOrEqual(
          TRAINER_WIDGET_TARGET_HEIGHT_PX,
        );
        expect(TRAINER_WIDGET_TARGET_HEIGHT_PX).toBeLessThan(
          TELEGRAM_WIDGET_MAX_HEIGHT_PX,
        );
      },
    );
  });

  it("draws the home screen from the chat state of the message", async () => {
    const page = await openWidget(320, {
      chatData: JSON.stringify(["h", 4, 3, 5, 1]),
    });

    const text = await page.locator("#w").innerText();

    expect(text).toContain("Серия: 4 дня");
    expect(text).toContain("3 из 5 вопросов");
    expect(text).toContain("Пройден");
    expect(await requests(page)).toEqual([]);
  });

  it("draws the home screen of a first opening inside a 320 px bubble", async () => {
    // The chat state the bot sends for a person who has not answered a question yet.
    const page = await openWidget(320, { chatData: '["h",0,0,5,0]' });

    for (const name of [
      "Проверить себя",
      "Вопрос дня",
      "Тренировка по теме",
      "Прогресс",
      "Рейтинг",
    ])
      await expect(buttonNamed(page, name).count()).resolves.toBe(1);
    const text = await page.locator("#w").innerText();
    expect(text).toContain("Серия: 0 дней");
    expect(text).toContain("0 из 5 вопросов");
    const measured = await layout(page);
    expect(measured.overflowing).toEqual([]);
    expect(measured.pageWidth).toBe(320);
    expect(measured.height).toBeLessThanOrEqual(560);
    expect(await requests(page)).toEqual([]);
  });

  it("shows the bot's answer for a section that is not open and returns home", async () => {
    const page = await openWidget(320, { chatData: '["h",0,0,5,0]' });

    await tap(page, "Проверить себя", ["x", "Этот раздел скоро откроется."]);

    expect(await page.locator("#w").innerText()).toContain(
      "Этот раздел скоро откроется.",
    );
    await buttonNamed(page, "На главный").click();
    await expect(buttonNamed(page, "Вопрос дня").count()).resolves.toBe(1);
    expect(await requests(page)).toEqual(["q"]);
  });

  it("draws an empty home screen when the message has no readable chat state", async () => {
    const page = await openWidget(320, { chatData: "not json" });

    expect(await page.locator("#w").innerText()).toContain("Серия: 0 дней");
  });

  it("redraws the home screen when the bot changes the chat state", async () => {
    const page = await openWidget(320);

    await page.evaluate(
      `TelegramWidget.chatData = ${JSON.stringify(JSON.stringify(["h", 21, 1, 5, 0]))}; widgetEvents.chatDataChanged()`,
    );

    expect(await page.locator("#w").innerText()).toContain("Серия: 21 день");
  });

  it("uses the Inside accent of the chat's colour scheme", async () => {
    const light = await openWidget(320);
    const dark = await openWidget(320, { theme: "dark" });
    const accent = (page: Page) =>
      page
        .getByRole("button", { name: "Проверить себя" })
        .evaluate((button) => getComputedStyle(button).backgroundColor);

    expect(await accent(light)).toBe("rgb(199, 70, 30)");
    expect(await accent(dark)).toBe("rgb(239, 107, 60)");
  });

  it("sends one answer for a tap on an option of a single-answer question", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", [
      "q",
      "7k",
      "Синтетическая тема",
      "Синтетический вопрос 1",
      ["Синтетический вариант 1", "Синтетический вариант 2"],
      0,
      "",
      5,
    ]);

    await tap(page, "Б Синтетический вариант 2", [
      "e",
      2,
      0b10,
      0b10,
      "Синтетический разбор 1",
      "1",
      5,
      0,
    ]);

    expect(await requests(page)).toEqual(["q", "a7k:2"]);
    const text = await page.locator("#w").innerText();
    expect(text).toContain("Верно, +1 очко");
    expect(text).toContain("Синтетический разбор 1");
    expect(text).not.toContain("Синтетический вариант 1");
    await expect(
      page.getByRole("button", { name: "Дальше" }).isVisible(),
    ).resolves.toBe(true);
  });

  it("collects several options and sends them only with «Ответить»", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", question(realisticText));
    const answerButton = page.getByRole("button", { name: "Ответить" });
    expect(await answerButton.isDisabled()).toBe(true);

    await page.getByRole("button", { name: /^А / }).click();
    await page.getByRole("button", { name: /^Г / }).click();
    await page.getByRole("button", { name: /^А / }).click();
    await page.getByRole("button", { name: /^В / }).click();
    expect(await requests(page)).toEqual(["q"]);
    await tap(page, "Ответить", explanation(realisticText));

    expect(await requests(page)).toEqual(["q", "a1a2b3c:12"]);
  });

  it("sends «Не знаю» as an answer without options", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", question(realisticText));

    await tap(page, "Не знаю", [
      "e",
      3,
      1,
      0,
      "Синтетический разбор 2",
      "0",
      5,
      0,
    ]);

    expect(await requests(page)).toEqual(["q", "a1a2b3c:0"]);
    expect(await page.locator("#w").innerText()).toContain("Разберём");
  });

  it("shows a retry state when the bot does not answer and repeats the same request", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", question(realisticText));

    await tap(page, "Не знаю");

    const text = await page.locator("#w").innerText();
    expect(text).toContain("Не получилось");
    expect(text).toContain("Бот не ответил");
    await tap(page, "Повторить", explanation(realisticText));
    expect(await requests(page)).toEqual(["q", "a1a2b3c:0", "a1a2b3c:0"]);
    expect(await page.locator("#w").innerText()).toContain("Неверно");
  });

  it("shows the bot's own refusal text and returns home without a request", async () => {
    const page = await openWidget(320);

    await tap(page, "Рейтинг", ["x", "Слишком часто. Повторите позже."]);

    expect(await page.locator("#w").innerText()).toContain(
      "Слишком часто. Повторите позже.",
    );
    await page.getByRole("button", { name: "На главный" }).click();
    expect(await page.locator("#w").innerText()).toContain("Тренажёр");
    expect(await requests(page)).toEqual(["l0"]);
  });

  it("shows the retry state for an answer it cannot read", async () => {
    const page = await openWidget(320);
    await queueAnswer(page, '["q",1]');

    await page.getByRole("button", { name: "Проверить себя" }).click();

    await page.getByRole("button", { name: "Повторить" }).waitFor();
  });

  it("shows bot text as text, never as markup", async () => {
    const page = await openWidget(320);

    await tap(page, "Рейтинг", [
      "l",
      0,
      1,
      [[1, "<img src=x onerror=widgetRequests.push('injected')>", 5, 1]],
    ]);

    expect(await page.locator("#w img").count()).toBe(0);
    expect(await page.locator("#w").innerText()).toContain("<img src=x");
    expect(await requests(page)).toEqual(["l0"]);
  });

  it("sends only requests the bot's reader understands", async () => {
    const page = await openWidget(320);
    await tap(page, "Тренировка по теме", topics(realisticText));
    await tap(
      page,
      realisticText(40, 2) + " 20 из 20",
      question(realisticText),
    );
    await tap(page, "Не знаю", explanation(realisticText));
    await tap(page, "Дальше", result(realisticText));
    await tap(page, "Другая тема", topics(realisticText));
    await tap(page, "←", home);
    await tap(page, "Вопрос дня", question(realisticText, 0));
    await tap(page, "Показать разбор", explanation(realisticText));
    await tap(page, "×", home);
    await tap(page, "Прогресс", progress(realisticText));
    await tap(page, "←", home);
    await tap(page, "Рейтинг", rating(realisticText));
    await tap(page, "Всё время", ["l", 1, 1, []]);
    await tap(
      page,
      "Показывать меня в рейтинге Другие видят ваше имя из Telegram Вкл",
      ["l", 1, 0, []],
    );

    const sent = await requests(page);

    expect(sent).toEqual([
      "t",
      "ttopic2",
      "a1a2b3c:0",
      "n",
      "t",
      "h",
      "d",
      "a1a2b3c:0",
      "h",
      "p",
      "h",
      "l0",
      "l1",
      "v01",
    ]);
    expect(sent.map((data) => parseTrainerWidgetRequest(data))).not.toContain(
      undefined,
    );
  });
});
