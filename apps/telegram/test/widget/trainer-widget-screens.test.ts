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
function explanation(
  text: Filler,
  correctMask = 0b0011,
  pickedMask = 0b1100,
): TrainerExplanationData {
  return [
    "e",
    0,
    correctMask,
    pickedMask,
    text(TRAINER_EXPLANATION_MAX_CHARS, 2),
    "10100",
    10,
    text(TRAINER_STAT_LINE_MAX_CHARS, 3),
  ];
}
const result = (text: Filler, topicRound: 0 | 1 = 1): TrainerWidgetData => [
  "r",
  text(TRAINER_RESULT_TITLE_MAX_CHARS),
  10,
  10,
  text(TRAINER_RESULT_COMMENT_MAX_CHARS, 1),
  10,
  365,
  9_999,
  topicRound,
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
const rating = (text: Filler, shown: 0 | 1 | 2 = 1): TrainerWidgetData => [
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
  {
    name: "round result of «Проверить себя»",
    steps: (text) => [["Проверить себя", result(text, 0)]],
  },
  {
    name: "explanation of a single pick",
    steps: (text) => [
      ["Проверить себя", question(text)],
      ["Не знаю", explanation(text, 0b0001, 0b1000)],
    ],
  },
  { name: "Progress", steps: (text) => [["Прогресс", progress(text)]] },
  { name: "Rating", steps: (text) => [["Рейтинг", rating(text)]] },
  {
    name: "Rating with the display off",
    steps: (text) => [["Рейтинг", rating(text, 0)]],
  },
  {
    name: "Rating with the offer of the first opening",
    steps: (text) => [["Рейтинг", rating(text, 2)]],
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
  /** Computed pixels after the widget adapts to the platform’s font metrics. */
  readonly fontSize: number;
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
      fontSize: Number.parseFloat(getComputedStyle(root).fontSize),
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
        "$name fits 560 px with the default text setting, readable text and no overflow",
        async (route) => {
          const page = await openWidget(width);
          await reach(page, route, realisticText);

          const measured = await layout(page);

          expect(measured.overflowing).toEqual([]);
          expect(measured.pageWidth).toBe(width);
          expect(measured.fontSize).toBeGreaterThanOrEqual(11);
          expect(measured.fontSize).toBeLessThanOrEqual(15);
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
        expect(measured.fontSize).toBeGreaterThanOrEqual(11);
        expect(measured.fontSize).toBeLessThanOrEqual(options.textSizePx);
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

  it("offers to be shown on the first opening of the Rating and turns the display on only by the person's tap", async () => {
    const page = await openWidget(320);
    const table = [[1, "Анна", 5, 0]] as const;

    await tap(page, "Рейтинг", ["l", 0, 2, table]);
    const offer = await page.locator("#w").innerText();
    const switches = await buttonNamed(
      page,
      "Показывать меня в рейтинге",
    ).count();
    await tap(page, "Всё время", ["l", 1, 2, table]);
    await tap(page, "Показать меня", ["l", 1, 1, [[1, "Анна", 5, 1]]]);
    const afterConsent = await page.locator("#w").innerText();

    expect(offer).toContain("Показать вас в рейтинге?");
    expect(offer).toContain("Другие увидят ваше имя из Telegram");
    // Before the choice there is an offer with two answers, not a switch.
    expect(switches).toBe(0);
    expect(await requests(page)).toEqual(["l0", "l1", "v11"]);
    expect(afterConsent).not.toContain("Показать вас в рейтинге?");
    expect(afterConsent).toContain("Показывать меня в рейтинге");
    expect(afterConsent).toContain("Вкл");
  });

  it("keeps the display off after «Не сейчас» and leaves a switch to turn it on later", async () => {
    const page = await openWidget(320);

    await tap(page, "Рейтинг", ["l", 0, 2, []]);
    await tap(page, "Не сейчас", ["l", 0, 0, []]);
    const declined = await page.locator("#w").innerText();
    await tap(page, "Показывать меня в рейтинге", ["l", 0, 1, []]);

    expect(declined).not.toContain("Показать вас в рейтинге?");
    expect(declined).toContain("Сейчас вас нет в таблицах");
    expect(declined).toContain("Выкл");
    expect(await requests(page)).toEqual(["l0", "v00", "v10"]);
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
      "n1a2b3c",
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

  describe("in «Тренировка по теме»", () => {
    /** Nine topics as the bot sends them: names of the limit length and the person's counters. */
    const nineTopics: TrainerWidgetData = [
      "t",
      Array.from({ length: 9 }, (_, index) => [
        `t${String(index + 1)}`,
        realisticText(TRAINER_TOPIC_NAME_MAX_CHARS, index),
        index * 2,
        20,
      ]),
    ];

    it("lists nine topics with their counters within 560 px in a 320 px bubble and starts the tapped topic", async () => {
      const page = await openWidget(320);

      await tap(page, "Тренировка по теме", nineTopics);

      const rows = await page.getByRole("button").allInnerTexts();
      for (const index of [0, 4, 8]) {
        const row = rows.find((each) =>
          each.includes(realisticText(TRAINER_TOPIC_NAME_MAX_CHARS, index)),
        );
        expect(row).toContain(`${String(index * 2)} из 20`);
      }
      const measured = await layout(page);
      expect(measured.overflowing).toEqual([]);
      expect(measured.pageWidth).toBe(320);
      expect(measured.fontSize).toBeGreaterThanOrEqual(11);
      expect(measured.fontSize).toBeLessThanOrEqual(15);
      expect(measured.height).toBeLessThanOrEqual(560);

      await tap(
        page,
        realisticText(TRAINER_TOPIC_NAME_MAX_CHARS, 8),
        question(realisticText),
      );
      expect(await requests(page)).toEqual(["t", "tt9"]);
    });

    it("names the topic in the result and offers another topic or home", async () => {
      const page = await openWidget(320);
      await tap(page, "Тренировка по теме", nineTopics);

      await tap(page, realisticText(TRAINER_TOPIC_NAME_MAX_CHARS, 0), [
        "r",
        "Синтетическая тема 1",
        7,
        10,
        "Хороший результат. Разборы помогут закрыть пробелы.",
        0,
        0,
        0,
        1,
      ]);

      const shown = await page.locator("#w").innerText();
      expect(shown).toContain("Синтетическая тема 1");
      expect(shown).toContain("7 из 10");
      expect(
        (await page.getByRole("button").allInnerTexts()).slice(0, 2),
      ).toEqual(["Другая тема", "На главный"]);
      await tap(page, "Другая тема", nineTopics);
      await tap(page, "←", home);
      expect(await requests(page)).toEqual(["t", "tt1", "t", "h"]);
    });
  });

  describe("in a round of «Проверить себя»", () => {
    const TOO_OFTEN = "Слишком часто. Повторите через несколько секунд.";
    /** A question of the round as the bot sends it: one correct option, no answers inside. */
    const asked = (issueId: string, marks: string): TrainerQuestionData => [
      "q",
      issueId,
      "Синтетическая тема",
      "Синтетический вопрос",
      [
        "Синтетический вариант 1",
        "Синтетический вариант 2",
        "Синтетический вариант 3",
        "Синтетический вариант 4",
      ],
      0,
      marks,
      5,
    ];
    /** The step strip: G a correct answer, B a wrong one, S the current step. */
    const steps = (page: Page): Promise<string[]> =>
      page
        .locator("#w .q i")
        .evaluateAll((marks) =>
          marks.map((mark) => mark.getAttribute("class") ?? ""),
        );
    /** The options on the screen with their mark: G correct, B picked and wrong. */
    const options = (page: Page): Promise<string[]> =>
      page
        .locator("#w .o")
        .evaluateAll((rows) =>
          rows.map(
            (row) =>
              `${row.textContent} ${/ ([GB]) /.exec(row.getAttribute("class") ?? "")?.[1] ?? "-"}`,
          ),
        );
    const buttons = (page: Page): Promise<string[]> =>
      page.getByRole("button").allInnerTexts();

    it("draws the explicit Daily mode with «Готово» and a neutral message without retry", async () => {
      const page = await openWidget(320);
      const daily: [...TrainerQuestionData] = [...asked("7k", "")];
      daily[7] = 1;
      daily[8] = null;
      daily[9] = 1;
      await tap(page, "Вопрос дня", daily);
      expect(await page.locator("#w").innerText()).toContain("Вопрос дня");
      await tap(page, "А Синтетический вариант 1", [
        "e",
        2,
        1,
        1,
        "Разбор.",
        "1",
        1,
        "Верно ответили 100% из 1 человека",
      ]);
      expect(await buttons(page)).toEqual(["×", "Готово"]);
      await tap(page, "Готово", home);
      await tap(page, "Проверить себя", ["i", "Вопросы скоро появятся."]);
      expect(await buttons(page)).toEqual(["На главный"]);
      expect(await page.locator("#w").innerText()).not.toContain(
        "Не получилось",
      );
      await page.close();
    });

    it("finishes a one-question check round through its result, and names its own issue in next", async () => {
      const page = await openWidget(320);
      const one: [...TrainerQuestionData] = [...asked("7k", "")];
      one[7] = 1;
      await tap(page, "Проверить себя", one);
      expect(await page.locator("#w").innerText()).not.toContain("Вопрос дня");
      await tap(page, "А Синтетический вариант 1", [
        "e",
        2,
        1,
        1,
        "Разбор.",
        "1",
        1,
        0,
      ]);
      expect(await buttons(page)).toEqual(["×", "К итогу"]);
      await tap(page, "К итогу", [
        "r",
        "Проверить себя",
        1,
        1,
        "Все ответы верные.",
        1,
        1,
        0,
        0,
      ]);
      expect((await requests(page)).at(-1)).toBe("n7k");
      await page.close();
    });

    it("keeps only the picked and the correct options with the explanation after an answer", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", asked("7k", "10"));
      expect(await steps(page)).toEqual(["G", "B", "S", "", ""]);
      expect(await options(page)).toHaveLength(4);

      await tap(page, "В Синтетический вариант 3", [
        "e",
        0,
        0b0001,
        0b0100,
        "Синтетический разбор",
        "100",
        5,
        0,
      ]);

      const text = await page.locator("#w").innerText();
      expect(text).toContain("Неверно");
      expect(text).toContain("Синтетический разбор");
      expect(await options(page)).toEqual([
        "АСинтетический вариант 1 G",
        "ВСинтетический вариант 3 B",
      ]);
      expect(await steps(page)).toEqual(["G", "B", "B", "S", ""]);
      expect(text).not.toMatch(/Где почитать|В вопросе ошибка/);
      expect(await buttons(page)).toEqual(["×", "Дальше"]);
    });

    it("shows a correct answer without a point as «Верно»", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", asked("7k", ""));

      await tap(page, "А Синтетический вариант 1", [
        "e",
        1,
        0b0001,
        0b0001,
        "Синтетический разбор",
        "1",
        5,
        0,
      ]);

      const text = await page.locator("#w").innerText();
      expect(text).toContain("Верно");
      expect(text).not.toContain("очко");
      expect(await options(page)).toEqual(["АСинтетический вариант 1 G"]);
    });

    it("goes from the last explanation to the result and offers another round or home", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", asked("7k", "1101"));
      await tap(page, "Не знаю", [
        "e",
        3,
        0b0001,
        0,
        "Синтетический разбор",
        "11010",
        5,
        0,
      ]);
      expect(await steps(page)).toEqual(["G", "G", "B", "G", "B"]);

      await tap(page, "К итогу", [
        "r",
        "Проверить себя",
        3,
        5,
        "Хороший результат. Разборы помогут закрыть пробелы.",
        0,
        0,
        0,
        0,
      ]);

      const text = await page.locator("#w").innerText();
      expect(text).toContain("Проверить себя");
      expect(text).toContain("3 из 5");
      expect(await buttons(page)).toEqual([
        "Ещё раунд",
        "На главный",
        "Рейтинг",
      ]);
      await tap(page, "Ещё раунд", asked("7q", ""));
      expect(await steps(page)).toEqual(["S", "", "", "", ""]);
      await tap(page, "×", home);
      expect(await requests(page)).toEqual(["q", "a7k:0", "n7k", "q", "h"]);
    });

    it("returns home from the result with fresh numbers from the bot", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", [
        "r",
        "Проверить себя",
        5,
        5,
        "Все ответы верные.",
        0,
        0,
        0,
        0,
      ]);

      await tap(page, "На главный", ["h", 1, 5, 5, 0]);

      expect(await requests(page)).toEqual(["q", "h"]);
      expect(await page.locator("#w").innerText()).toContain("5 из 5 вопросов");
    });

    it("shows the request limit text on an answer and repeats the same answer", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", asked("7k", ""));

      await tap(page, "Б Синтетический вариант 2", ["x", TOO_OFTEN]);

      const text = await page.locator("#w").innerText();
      expect(text).toContain("Не получилось");
      expect(text).toContain(TOO_OFTEN);
      expect(await buttons(page)).toEqual(["Повторить", "На главный"]);
      await tap(page, "Повторить", [
        "e",
        0,
        0b0001,
        0b0010,
        "Синтетический разбор",
        "0",
        5,
        0,
      ]);
      expect(await requests(page)).toEqual(["q", "a7k:2", "a7k:2"]);
      expect(await options(page)).toEqual([
        "АСинтетический вариант 1 G",
        "БСинтетический вариант 2 B",
      ]);
    });

    it("shows a retry state when the next question does not come and asks for it again", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", asked("7k", ""));
      await tap(page, "Не знаю", [
        "e",
        3,
        0b0001,
        0,
        "Синтетический разбор",
        "0",
        5,
        0,
      ]);

      await tap(page, "Дальше");

      expect(await page.locator("#w").innerText()).toContain(
        "Бот не ответил. Проверьте связь и повторите.",
      );
      await tap(page, "Повторить", asked("7l", "0"));
      expect(await requests(page)).toEqual(["q", "a7k:0", "n7k", "n7k"]);
      expect(await steps(page)).toEqual(["B", "S", "", "", ""]);
    });

    it("shows the bot's refusal of a closed question and returns home without a request", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", asked("7k", ""));

      await tap(page, "А Синтетический вариант 1", [
        "x",
        "Этот вопрос уже закрыт. Начните новый раунд.",
      ]);

      expect(await page.locator("#w").innerText()).toContain(
        "Этот вопрос уже закрыт. Начните новый раунд.",
      );
      await page.getByRole("button", { name: "На главный" }).click();
      expect(await page.locator("#w").innerText()).toContain("Цель на сегодня");
      expect(await requests(page)).toEqual(["q", "a7k:1"]);
    });
  });
});
