import { type Browser, type Page, chromium, webkit } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  TELEGRAM_WIDGET_MAX_HEIGHT_PX,
  TRAINER_CONTEXT_MAX_CHARS,
  TRAINER_EXPLANATION_MAX_CHARS,
  TRAINER_FIRST_WIDGET_EXPLANATION_MAX_CHARS,
  TRAINER_FIRST_WIDGET_OPTIONS_TOTAL_MAX_CHARS,
  TRAINER_FIRST_WIDGET_QUESTION_MAX_CHARS,
  TRAINER_QUESTION_MAX_CHARS,
  TRAINER_RATING_NAME_MAX_CHARS,
  TRAINER_RATING_ROWS_MAX,
  TRAINER_RESULT_COMMENT_MAX_CHARS,
  TRAINER_RESULT_TITLE_MAX_CHARS,
  TRAINER_STAT_LINE_MAX_CHARS,
  TRAINER_TOPIC_NAME_MAX_CHARS,
  TRAINER_TOPICS_PAGE_SIZE,
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
  trainerExplanationParts,
} from "../../src/modules/trainer/widget/trainer-widget-wire.js";
import {
  type WidgetPageOptions,
  realisticText,
  splitLength,
  trainerWidgetPage,
  wideText,
  widgetBrowserLaunchOptions,
} from "./trainer-widget-harness.js";

// The built widget in Chromium with a stand-in TelegramWidget. It proves layout and behaviour
// of the HTML the bot sends; it does not prove how a Telegram app draws it (#2002 does).
// Every text is synthetic filler of the exact limit length.

type Filler = (length: number, seed?: number) => string;
const emojiText: Filler = (length) => "😀".repeat(length);

const home: TrainerHomeData = ["h", 365, 5, 5, 0];

function topics(text: Filler): TrainerWidgetData {
  return [
    "t",
    Array.from({ length: TRAINER_TOPICS_PAGE_SIZE }, (_, index) => [
      `topic${String(index)}`,
      text(TRAINER_TOPIC_NAME_MAX_CHARS, index),
      20,
      20,
    ]),
  ];
}
/**
 * The tallest question one answer of 1 024 bytes carries: four options and the «Ответить»
 * button. Ordinary text takes the longest question text with the options that still fit the
 * answer beside it. Text of the widest letters alone is not real text: it is checked at the
 * lengths a widget was first measured at, which it fits letter by letter.
 */
function question(
  text: Filler,
  reviewMask?: number,
  lengths: readonly [question: number, options: number] = text === realisticText
    ? [TRAINER_QUESTION_MAX_CHARS, 235]
    : [
        TRAINER_FIRST_WIDGET_QUESTION_MAX_CHARS,
        TRAINER_FIRST_WIDGET_OPTIONS_TOTAL_MAX_CHARS,
      ],
): TrainerQuestionData {
  const options = splitLength(lengths[1], 4).map((length, index) =>
    text(length, index),
  );
  const data = [
    "q",
    "1a2b3c",
    text(TRAINER_TOPIC_NAME_MAX_CHARS),
    text(lengths[0]),
    options,
    1,
    "1010",
    10,
  ] as const;
  return reviewMask === undefined ? data : [...data, reviewMask];
}
/**
 * Inline feedback keeps the longest question, all four options, explanation and statistics.
 * The explanation is one part: the longest one a single answer carried before parts.
 */
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
    text(TRAINER_FIRST_WIDGET_EXPLANATION_MAX_CHARS, 2),
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
    { length: TRAINER_TOPICS_PAGE_SIZE },
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
let webkitBrowser: Browser;

beforeAll(async () => {
  browser = await chromium.launch(widgetBrowserLaunchOptions());
  webkitBrowser = await webkit.launch(widgetBrowserLaunchOptions());
});
afterAll(async () => {
  await browser.close();
  await webkitBrowser.close();
});

async function openWidget(
  width: number,
  options: Partial<WidgetPageOptions> = {},
  engine: Browser = browser,
): Promise<Page> {
  const page = await engine.newPage({
    viewport: { width, height: TRAINER_WIDGET_TARGET_HEIGHT_PX },
    colorScheme: options.theme ?? "light",
  });
  await page.setContent(
    await trainerWidgetPage({ chatData: JSON.stringify(home), ...options }),
  );
  return page;
}

it("keeps the home screen inside the bubble in a client document without a doctype", async () => {
  const page = await openWidget(320, { documentMode: "quirks", theme: "dark" });
  try {
    expect(await page.evaluate(() => document.compatMode)).toBe("BackCompat");
    const root = await page.locator("#w").boundingBox();
    expect(root?.height).toBeLessThanOrEqual(TRAINER_WIDGET_TARGET_HEIGHT_PX);
    const body = await page.locator("body").boundingBox();
    expect(body?.height).toBe(root?.height);
    await expect(buttonNamed(page, "Проверить себя").isVisible()).resolves.toBe(
      true,
    );
  } finally {
    await page.close();
  }
});

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

/** What the widget asked the bot, without the mark every request starts with. */
const requests = async (page: Page): Promise<string[]> =>
  z
    .array(z.string().startsWith("2"))
    .parse(await page.evaluate("widgetRequests"))
    .map((request) => request.slice(1));

async function reach(page: Page, route: Route, text: Filler): Promise<void> {
  for (const [button, answer] of route.steps(text))
    await tap(page, button, answer);
}

describe.each(["Chromium", "WebKit"] as const)(
  "client document compatibility in %s",
  (engineName) => {
    it.each(routes)(
      "keeps $name in the same positions with or without a doctype",
      async (route) => {
        const engine = engineName === "WebKit" ? webkitBrowser : browser;
        for (const width of [320, 390]) {
          for (const theme of ["light", "dark"] as const) {
            const shapes = [];
            for (const documentMode of ["standards", "quirks"] as const) {
              const page = await openWidget(
                width,
                { theme, documentMode },
                engine,
              );
              try {
                await reach(page, route, realisticText);
                const root = await page.locator("#w").boundingBox();
                const body = await page.locator("body").boundingBox();
                expect(root?.height).toBeLessThanOrEqual(
                  TRAINER_WIDGET_TARGET_HEIGHT_PX,
                );
                expect(body?.height).toBe(root?.height);
                shapes.push(
                  await page.locator("#w").evaluate((root) =>
                    [root, ...root.querySelectorAll("*")].map((element) => {
                      const box = element.getBoundingClientRect();
                      const style = getComputedStyle(element);
                      return [
                        box.x,
                        box.y,
                        box.width,
                        box.height,
                        style.fontSize,
                        style.color,
                        style.backgroundColor,
                      ];
                    }),
                  ),
                );
              } finally {
                await page.close();
              }
            }
            expect(shapes[1]).toEqual(shapes[0]);
          }
        }
      },
    );
  },
);

interface Layout {
  readonly height: number;
  /** Computed pixels after the widget adapts to the platform’s font metrics. */
  readonly fontSize: number;
  /** Elements whose box leaves the bubble sideways. */
  readonly overflowing: string[];
  /** Hard shadows must remain inside the widget, including its bottom padding. */
  readonly clippedShadows: string[];
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
      clippedShadows: [...root.querySelectorAll<HTMLElement>("*")]
        .filter((element) => {
          const shadow = getComputedStyle(element).boxShadow;
          if (shadow === "none") return false;
          const [x = 0, y = 0, blur = 0, spread = 0] = [
            ...shadow.matchAll(/(-?[\d.]+)px/g),
          ].map((match) => Number(match[1]));
          const box = element.getBoundingClientRect();
          // Profile 1 permits hard shadows without the heavy-element limit.
          // Include the full painted extent, which getBoundingClientRect omits.
          return (
            box.right + x + blur + spread > width + 0.5 ||
            box.bottom + y + blur + spread >
              root.getBoundingClientRect().bottom + 0.5
          );
        })
        .map((element) => element.outerHTML.slice(0, 80)),
      overflowing: [...root.querySelectorAll<HTMLElement>("*")]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.left < 0 || box.right > width + 0.5;
        })
        .map((element) => element.outerHTML.slice(0, 80)),
    };
  });

// The boxes and text sizes of the steps, the question text and the drawn options, in that
// order. They stay fixed while the person picks. After an answer only the correct and the
// picked options stay: the steps, the text and the options above the first removed one keep
// their place, which the tests compare with the start of the list taken before the answer.
const questionGeometry = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#w .st i, #w .Q, #w .op")].map((element) => {
      const box = element.getBoundingClientRect();
      return [
        box.x,
        box.y,
        box.width,
        box.height,
        getComputedStyle(element).fontSize,
      ];
    }),
  );

/** The steps of a round: none in the Daily question, which has a title in their place. */
const stepCount = (page: Page) => page.locator("#w .st i").count();
/** «2/3» of the counter «разбор 2/3» beside the verdict; empty when the explanation is one page. */
const pageCounter = async (page: Page) =>
  /разбор (\d+\/\d+)$/.exec(
    (await page.locator(".fb .R").first().textContent()) ?? "",
  )?.[1] ?? "";

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
          expect(measured.clippedShadows).toEqual([]);
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

  it.each(routes)(
    "$name keeps its hard shadows inside a 320 px dark widget",
    async (route) => {
      const page = await openWidget(320, { theme: "dark" });
      await reach(page, route, wideText);
      const measured = await layout(page);
      expect(measured.clippedShadows).toEqual([]);
      expect(measured.overflowing).toEqual([]);
      expect(measured.fontSize).toBeGreaterThanOrEqual(11);
      expect(measured.height).toBeLessThanOrEqual(
        TRAINER_WIDGET_TARGET_HEIGHT_PX,
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
        expect(measured.clippedShadows).toEqual([]);
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

  it("keeps the whole long explanation reachable without extra bot requests", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", question(wideText));
    const answer = explanation(emojiText);
    await tap(page, "Не знаю", answer);
    const sent = await requests(page);
    const parts: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      parts.push((await page.locator(".fb .W").textContent()) ?? "");
      const next = buttonNamed(page, "→");
      if ((await next.count()) === 0 || (await next.isDisabled())) break;
      await next.click();
    }
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(`${answer[4]} ${answer[7]}`);
    expect(await requests(page)).toEqual(sent);
    expect((await layout(page)).height).toBeLessThanOrEqual(560);
    await page.close();
  });

  it("turns the pages of an explanation between words, their number settled on the first page", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", question(realisticText));
    const answer = explanation(realisticText);
    await tap(page, "Не знаю", answer);
    const pages: string[] = [];
    const counters: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      pages.push((await page.locator(".fb .W").textContent()) ?? "");
      counters.push(await pageCounter(page));
      const next = buttonNamed(page, "→");
      if ((await next.count()) === 0 || (await next.isDisabled())) break;
      await next.click();
    }

    const whole = `${answer[4]} ${String(answer[7])}`;
    expect(pages.length).toBeGreaterThan(1);
    // Every page was fitted before the first one was shown: no page gets smaller while the
    // person turns them, so the counter keeps its total and no word comes twice.
    // The counter stands beside the verdict and names what the arrows turn.
    expect(counters).toEqual(
      pages.map((_, index) => `${String(index + 1)}/${String(pages.length)}`),
    );
    expect(pages.join("")).toBe(whole);
    // No word is split: a space stands on one side of the place where a page starts.
    let start = 0;
    for (const text of pages) {
      expect(
        start === 0 || whole[start - 1] === " " || whole[start] === " ",
      ).toBe(true);
      start += text.length;
    }
    // The arrow back returns the page before the last one.
    await buttonNamed(page, "←").click();
    expect(await page.locator(".fb .W").textContent()).toBe(pages.at(-2));
    expect((await layout(page)).height).toBeLessThanOrEqual(560);
    await page.close();
  });

  it("names the pages of an explanation beside the verdict, and only when there are several", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", question(realisticText));
    // Every option is correct or picked, so all four stay and the explanation has pages.
    await tap(page, "Не знаю", explanation(realisticText));
    expect(await page.locator(".fb .R").first().textContent()).toMatch(
      /^Неверноразбор 1\/[2-9]$/,
    );
    await buttonNamed(page, "→").click();
    expect(await pageCounter(page)).toMatch(/^2\/[2-9]$/);
    await page.close();

    const short = await openWidget(320);
    await tap(short, "Проверить себя", question(realisticText));
    await tap(short, "Не знаю", ["e", 3, 1, 0, "Короткий разбор.", "0", 5, 0]);
    expect(await short.locator(".fb").innerText()).not.toContain("разбор 1");
    expect(await buttonNamed(short, "→").count()).toBe(0);
    await short.close();
  });

  it("gives the room of the options that left the screen to the explanation", async () => {
    const text = realisticText(450, 2);
    const pagesOf = async (correctMask: number, pickedMask: number) => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", question(realisticText));
      await tap(page, "Не знаю", [
        "e",
        0,
        correctMask,
        pickedMask,
        text,
        "0",
        5,
        0,
      ]);
      const total = Number((await pageCounter(page)).split("/")[1] ?? 1);
      expect((await layout(page)).height).toBeLessThanOrEqual(560);
      await page.close();
      return total;
    };

    // All four options stay when each is correct or picked; after «Не знаю» only the
    // correct one stays, and the same explanation needs fewer pages.
    const withEveryOption = await pagesOf(0b0011, 0b1100);
    const withOneOption = await pagesOf(0b0001, 0);
    expect(withEveryOption).toBeGreaterThan(1);
    expect(withOneOption).toBeLessThan(withEveryOption);
  });

  it("divides an explanation between its pages evenly: the last page is not a short tail", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", [
      "q",
      "7k",
      "Тема",
      "Вопрос?",
      ["Первый", "Второй"],
      0,
      "",
      5,
    ]);
    // A few characters more than the largest page holds.
    const text = realisticText(520, 2);
    await tap(page, "А Первый", ["e", 2, 1, 1, text, "1", 5, 0]);
    const pages: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      pages.push((await page.locator(".fb .W").textContent()) ?? "");
      const next = buttonNamed(page, "→");
      if ((await next.count()) === 0 || (await next.isDisabled())) break;
      await next.click();
    }

    expect(pages.join("")).toBe(text);
    expect(pages.length).toBeGreaterThan(1);
    const lengths = pages.map((each) => each.length);
    // The shortest page holds more than half of what the longest one does.
    expect(Math.min(...lengths) * 2).toBeGreaterThan(Math.max(...lengths));
    await page.close();
  });

  it("shows the like and the dislike larger than the text beside them", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", question(realisticText));
    await tap(page, "Не знаю", explanation(realisticText));
    await buttonNamed(page, "Оценить").click();

    const sizes = await page
      .locator(".fb button")
      .evaluateAll((buttons) =>
        buttons.map((button) =>
          Number.parseFloat(getComputedStyle(button).fontSize),
        ),
      );
    // 👍 and 👎, then the arrow back.
    expect(sizes).toHaveLength(3);
    expect(sizes[0]).toBeGreaterThanOrEqual(18);
    expect(sizes[1]).toBe(sizes[0]);
    expect(sizes[2]).toBeLessThan(Number(sizes[0]));
    await page.close();
  });

  it("makes no empty page when a cut falls after a space and the next page is one long word", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", [
      "q",
      "7k",
      "Тема",
      "Вопрос?",
      ["Первый", "Второй"],
      0,
      "",
      5,
    ]);
    // Three pages of 201 characters: the first ends with a space, the second has none.
    const text = `${"a".repeat(200)} ${"b".repeat(201)}${"c".repeat(198)}`;
    await tap(page, "А Первый", ["e", 2, 1, 1, text, "1", 5, 0]);
    const pages: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      pages.push((await page.locator(".fb .W").textContent()) ?? "");
      const next = buttonNamed(page, "→");
      if ((await next.count()) === 0 || (await next.isDisabled())) break;
      await next.click();
    }

    expect(pages).not.toContain("");
    expect(pages.join("")).toBe(text);
    await page.close();
  });

  it("keeps a line break of an explanation as text and loses nothing after it", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", [
      "q",
      "7k",
      "Тема",
      "Вопрос?",
      ["Первый", "Второй"],
      0,
      "",
      5,
    ]);
    await tap(page, "А Первый", [
      "e",
      2,
      1,
      1,
      "Абзац один.\n\nАбзац два.",
      "1",
      5,
      0,
    ]);

    // Both paragraphs are on the page, and no arrow leads to an empty one.
    expect(await page.locator(".fb .W").textContent()).toBe(
      "Абзац один.\n\nАбзац два.",
    );
    await expect(buttonNamed(page, "→").count()).resolves.toBe(0);
    await page.close();
  });

  it("keeps every question label and option at least eleven pixels", async () => {
    const page = await openWidget(320);
    await tap(page, "Проверить себя", question(wideText));
    const sizes = await page
      .locator("#w, #w .mu, #w .op, #w .y, #w .n")
      .evaluateAll((elements) =>
        elements.map((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      );
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
    await page.close();
  });

  it("keeps Rating rows spaced and aligned after class compression", async () => {
    const page = await openWidget(320);
    await tap(page, "Рейтинг", [
      "l",
      0,
      1,
      [
        [1, "Анна", 5, 0],
        [1234567, "Борис", 1, 1],
      ],
    ]);
    const rows = await page.locator(".rk").all();
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(34);
    expect((await layout(page)).overflowing).toEqual([]);
    await page.close();
  });

  it.each([
    [320, 20],
    [320, 32],
    [390, 20],
    [390, 32],
  ])(
    "protects the message time band at %i px with a %i px inset",
    async (width, inset) => {
      const page = await openWidget(
        width,
        { safeAreaBottomPx: inset },
        webkitBrowser,
      );
      await tap(page, "Проверить себя", question(wideText));
      const before = await questionGeometry(page);
      expect((await layout(page)).height).toBeLessThanOrEqual(560);
      await tap(page, "Не знаю", explanation(wideText));
      expect(await questionGeometry(page)).toEqual(before);
      expect((await layout(page)).height).toBeLessThanOrEqual(560);
      const band = await page.evaluate(() => {
        const button = document.querySelector(".fb .P");
        if (!button) throw new Error("The continue button is missing");
        return (
          document.body.getBoundingClientRect().bottom -
          button.getBoundingClientRect().bottom
        );
      });
      expect(band).toBeGreaterThanOrEqual(inset);
      await page.close();
    },
  );

  it("keeps short screens compact and anchors changes at the bottom", async () => {
    const page = await openWidget(320);
    expect((await layout(page)).height).toBeLessThan(420);
    await tap(page, "Проверить себя", [
      "q",
      "7k",
      "Тема",
      "Вопрос?",
      ["Первый", "Второй"],
      0,
      "",
      5,
    ]);
    expect((await layout(page)).height).toBeLessThan(350);
    const skip = await buttonNamed(page, "Не знаю").boundingBox();
    expect(skip?.height).toBeGreaterThanOrEqual(44);
    const box = await page.locator(".fb").boundingBox();
    expect(box?.height).toBeLessThan(90);
    expect(await page.evaluate("widgetResizeAnchor")).toBe("bottom");
    await page.close();
  });

  it("turns topic and Progress pages through bot requests", async () => {
    const page = await openWidget(320);
    const rows = [
      ["t1", "Тема 1", 0, 1],
      ["t2", "Тема 2", 0, 1],
      ["t3", "Тема 3", 0, 1],
    ] as const;
    await tap(page, "Тренировка по теме", ["t", rows, 0, 4]);
    await tap(page, "→", ["t", [["t4", "Тема 4", 0, 1]], 1, 4]);
    expect((await requests(page)).at(-1)).toBe("t:1");
    await queueAnswer(page, encodeTrainerWidgetData(["t", rows, 0, 4]));
    await page.locator("button[onclick=\"g('t:0')\"]").click();
    await page.waitForFunction(
      "widgetRequests.at(-1) === '2t:0' && document.querySelector('#w').className === ''",
    );
    expect((await requests(page)).at(-1)).toBe("t:0");
    await queueAnswer(page, encodeTrainerWidgetData(home));
    await page.locator(".x").click();
    await page.waitForFunction("document.querySelector('#w .U.a') !== null");
    await tap(page, "Прогресс", ["p", 0, 0, 0, [["Тема 1", 0, 1, -1]], 0, 4]);
    await tap(page, "→", ["p", 0, 0, 0, [["Тема 4", 0, 1, -1]], 1, 4]);
    expect((await requests(page)).at(-1)).toBe("p:1");
    await page.close();
  });

  it.each([
    [320, 12, 4],
    [390, 13, 2],
  ] as const)(
    "keeps a question at the text limits readable in a %i px bubble: at least %i px",
    async (width, smallest, longestExplanationPages) => {
      const page = await openWidget(width);
      await tap(page, "Проверить себя", question(realisticText));
      const asked = await layout(page);
      // The reserve under the options holds the verdict, two lines of the explanation and
      // the buttons; the rest of the screen belongs to the question's own text.
      expect(asked.fontSize).toBeGreaterThanOrEqual(smallest);
      expect(asked.height).toBeLessThanOrEqual(TRAINER_WIDGET_TARGET_HEIGHT_PX);
      await tap(page, "Не знаю", explanation(realisticText));
      expect((await layout(page)).height).toBeLessThanOrEqual(
        TRAINER_WIDGET_TARGET_HEIGHT_PX,
      );
      // The price of the smaller reserve: the longest explanation takes a few pages.
      const pages = Number(
        /\/(\d+)/.exec(await page.locator(".fb").innerText())?.[1] ?? 1,
      );
      expect(pages).toBeLessThanOrEqual(longestExplanationPages);
      await page.close();
    },
  );

  it("draws the home screen from the chat state of the message", async () => {
    const page = await openWidget(320, {
      chatData: JSON.stringify(["h", 4, 3, 5, 1]),
    });

    const text = await page.locator("#w").innerText();

    expect(text).toContain("Серия: 4 дня");
    expect(text).toContain("3 из 5 вопросов");
    expect(text).not.toContain("Пройден");
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
    expect(measured.clippedShadows).toEqual([]);
    expect(measured.pageWidth).toBe(320);
    expect(measured.height).toBeLessThanOrEqual(560);
    expect(await requests(page)).toEqual([]);
  });

  it.each(["Chromium", "WebKit"])(
    "fills the Daily goal up to its inner corners without pale gaps in %s",
    async (engine) => {
      for (const width of [320, 430]) {
        for (const documentMode of ["standards", "quirks"] as const) {
          for (const done of [0, 1, 5]) {
            const page = await openWidget(
              width,
              { chatData: JSON.stringify(["h", 1, done, 5, 0]), documentMode },
              engine === "WebKit" ? webkitBrowser : browser,
            );
            try {
              // Read the rendered pixels, not the CSS radius: a rounded fill can leave
              // pale crescents even when its bounding box reaches both borders.
              const png = await page.locator(".T").screenshot();
              const pixels = await page.evaluate(async (base64) => {
                const image = new Image();
                image.src = `data:image/png;base64,${base64}`;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Cannot read the rendered goal");
                context.drawImage(image, 0, 0);
                return (
                  [
                    [3, 3],
                    [3, image.height - 3],
                    [image.width - 4, 3],
                    [image.width - 4, image.height - 3],
                    [Math.floor(image.width / 10), 6],
                    [Math.floor(image.width / 2), 6],
                  ] as const
                ).map(([x, y]) =>
                  Array.from(context.getImageData(x, y, 1, 1).data),
                );
              }, png.toString("base64"));
              const orange = [199, 70, 30, 255];
              const paper = [255, 239, 220, 255];
              expect(pixels).toEqual([
                done > 0 ? orange : paper,
                done > 0 ? orange : paper,
                done === 5 ? orange : paper,
                done === 5 ? orange : paper,
                done > 0 ? orange : paper,
                done === 5 ? orange : paper,
              ]);
            } finally {
              await page.close();
            }
          }
        }
      }
    },
  );

  it.each([0, 1])(
    "gives every home mode the same appearance without a Daily status badge (answered: %s)",
    async (answered) => {
      for (const theme of ["light", "dark"] as const) {
        const page = await openWidget(320, {
          chatData: JSON.stringify(["h", 1, 5, 5, answered]),
          theme,
        });
        const appearances = [];
        for (const name of [
          "Проверить себя",
          "Вопрос дня",
          "Тренировка по теме",
        ])
          appearances.push(
            await buttonNamed(page, name).evaluate((button) => {
              const style = getComputedStyle(button);
              return [style.backgroundColor, style.borderColor, style.color];
            }),
          );
        expect(appearances[0]).toEqual(appearances[1]);
        expect(appearances[1]).toEqual(appearances[2]);
        const text = await page.locator("#w").innerText();
        expect(text).not.toContain("Новый");
        expect(text).not.toContain("Пройден");
      }
    },
  );

  it.each([
    ["light", "rgb(199, 70, 30)", "rgb(255, 239, 220)"],
    ["dark", "rgb(199, 70, 30)", "rgb(255, 239, 220)"],
  ] as const)(
    "uses outlined warm cards and crisp offset shadows equally in the %s theme",
    async (theme, accent, surface) => {
      const page = await openWidget(320, { theme });
      const titleColor = await page
        .getByText("Тренажёр", { exact: true })
        .evaluate((title) => getComputedStyle(title).color);
      expect(titleColor).toBe(accent);
      for (const name of [
        "Проверить себя",
        "Вопрос дня",
        "Тренировка по теме",
        "Прогресс",
        "Рейтинг",
      ]) {
        const style = await buttonNamed(page, name).evaluate((button) => {
          const computed = getComputedStyle(button);
          return {
            bottom: computed.borderBottomColor,
            top: computed.borderTopColor,
            background: computed.backgroundColor,
            text: computed.color,
            shadow: computed.boxShadow,
            radius: computed.borderRadius,
          };
        });
        expect(style.bottom).toBe(accent);
        expect(style.top).not.toBe(accent);
        expect(style.background).toBe(surface);
        expect(style.radius).toBe("8px");
        expect(style.shadow).toMatch(/4px 4px 0px 0px$/);
        expect(style.text).not.toBe(accent);
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "distinguishes correct and wrong choices by shape in the %s theme",
    async (theme) => {
      const page = await openWidget(320, { theme });
      await tap(page, "Проверить себя", question(realisticText));
      await tap(page, "Не знаю", explanation(realisticText));
      const correct = await page
        .locator(".op.G")
        .first()
        .evaluate((option) => {
          const letter = option.querySelector(".y");
          if (!letter) throw new Error("The option letter is missing");
          return {
            border: getComputedStyle(option).borderTopStyle,
            letter: getComputedStyle(letter).backgroundColor,
          };
        });
      const wrong = await page
        .locator(".op.B")
        .first()
        .evaluate((option) => {
          const letter = option.querySelector(".y");
          if (!letter) throw new Error("The option letter is missing");
          return {
            border: getComputedStyle(option).borderTopStyle,
            letter: getComputedStyle(letter).backgroundColor,
          };
        });
      expect(correct.border).toBe("solid");
      expect(wrong.border).toBe("dashed");
      expect(correct.letter).not.toBe(wrong.letter);
      expect((await layout(page)).clippedShadows).toEqual([]);
    },
  );

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

  it("keeps the same Inside accent in either chat colour scheme", async () => {
    const light = await openWidget(320);
    const dark = await openWidget(320, { theme: "dark" });
    const accent = (page: Page) =>
      page
        .locator(".T i")
        .evaluate((button) => getComputedStyle(button).backgroundColor);

    expect(await accent(light)).toBe("rgb(199, 70, 30)");
    expect(await accent(dark)).toBe("rgb(199, 70, 30)");
  });

  it.each([
    ["light", "usual", realisticText, 15],
    ["dark", "usual", realisticText, 15],
    ["light", "wide", wideText, 15],
    ["dark", "wide", wideText, 15],
    ["light", "large", realisticText, 23],
    ["dark", "large", realisticText, 23],
  ] as const)(
    "keeps the question text and the marked options in place in the %s theme with %s text",
    async (theme, _label, text, textSizePx) => {
      const page = await openWidget(320, { theme, textSizePx });
      await tap(page, "Проверить себя", question(text));
      const before = await questionGeometry(page);
      await buttonNamed(page, "А ").click();
      expect(await questionGeometry(page)).toEqual(before);
      await tap(page, "Ответить", explanation(text, 0b0011, 0b0001));
      // The steps, the text and the two marked options stay where they were; the other two
      // options are gone.
      expect(await questionGeometry(page)).toEqual(
        before.slice(0, (await stepCount(page)) + 3),
      );
      expect(await page.locator(".fb").innerText()).toContain("Неверно");
      await page.close();
    },
  );

  it.each([
    ["light", 320, 15, "wide", wideText],
    ["dark", 320, 23, "wide", wideText],
    ["light", 390, 23, "wide", wideText],
    ["dark", 430, 23, "wide", wideText],
    ["light", 320, 15, "emoji", emojiText],
    ["dark", 320, 23, "emoji", emojiText],
    ["light", 390, 23, "emoji", emojiText],
    ["dark", 430, 23, "emoji", emojiText],
  ] as const)(
    "reserves long feedback for a short question in %s at %i px and %i px text with %s symbols",
    async (theme, width, textSizePx, _symbols, text) => {
      const page = await openWidget(width, { theme, textSizePx });
      await tap(page, "Проверить себя", [
        "q",
        "7k",
        "Тема",
        "Вопрос?",
        ["Первый", "Второй"],
        0,
        "",
        5,
      ]);
      const before = await questionGeometry(page);
      await tap(page, "А Первый", [
        "e",
        2,
        1,
        1,
        text(TRAINER_FIRST_WIDGET_EXPLANATION_MAX_CHARS, 2),
        "1",
        5,
        wideText(TRAINER_STAT_LINE_MAX_CHARS, 3),
      ]);
      expect(await questionGeometry(page)).toEqual(
        before.slice(0, (await stepCount(page)) + 2),
      );
      expect((await layout(page)).height).toBeLessThanOrEqual(
        TRAINER_WIDGET_TARGET_HEIGHT_PX,
      );
      await page.close();
    },
  );

  it.each(["light", "dark"] as const)(
    "keeps maximum question geometry with emoji feedback in %s",
    async (theme) => {
      const page = await openWidget(320, { theme, textSizePx: 23 });
      await tap(page, "Проверить себя", question(wideText));
      const before = await questionGeometry(page);
      await buttonNamed(page, "А ").click();
      await tap(page, "Ответить", [
        "e",
        0,
        3,
        1,
        emojiText(TRAINER_FIRST_WIDGET_EXPLANATION_MAX_CHARS),
        "10100",
        10,
        wideText(TRAINER_STAT_LINE_MAX_CHARS, 3),
      ]);
      expect(await questionGeometry(page)).toEqual(
        before.slice(0, (await stepCount(page)) + 3),
      );
      expect((await layout(page)).height).toBeLessThanOrEqual(
        TRAINER_WIDGET_TARGET_HEIGHT_PX,
      );
      await page.close();
    },
  );

  it.each([
    ["light", 0, 2],
    ["dark", 0, 2],
    ["light", 2, 1],
    ["dark", 2, 1],
  ] as const)(
    "uses the same readable panel ink in %s for verdict %i",
    async (theme, verdict, pickedMask) => {
      const page = await openWidget(320, { theme });
      await tap(page, "Проверить себя", [
        "q",
        "7k",
        "Тема",
        "Вопрос?",
        ["Первый", "Второй"],
        0,
        "",
        5,
      ]);
      await tap(page, pickedMask === 1 ? "А Первый" : "Б Второй", [
        "e",
        verdict,
        1,
        pickedMask,
        "Синтетический разбор.",
        verdict === 2 ? "1" : "0",
        5,
        0,
      ]);
      const colours = await page.evaluate(() => {
        const title = document.querySelector(".fb .V");
        if (!title) throw new Error("The feedback verdict is missing");
        return [
          getComputedStyle(title).color,
          getComputedStyle(document.body).color,
        ];
      });
      expect(colours[0]).toBe(
        verdict === 0 ? "rgb(182, 56, 41)" : "rgb(39, 118, 71)",
      );
      await page.close();
    },
  );

  it.each(["light", "dark"] as const)(
    "keeps the feedback area on the paper with separation in %s",
    async (theme) => {
      const page = await openWidget(320, { theme });
      await tap(page, "Проверить себя", question(realisticText));
      const paperArea = () =>
        page.evaluate(() => {
          const panel = document.querySelector(".fb");
          const title = document.querySelector(".fb .V");
          const option = [...document.querySelectorAll(".op")].at(-1);
          if (!panel || !title || !option)
            throw new Error("The question area is missing");
          const style = getComputedStyle(panel);
          return {
            background: style.backgroundColor,
            border: style.borderTopWidth,
            separation:
              title.getBoundingClientRect().top -
              option.getBoundingClientRect().bottom -
              4,
          };
        });
      for (const result of [
        await paperArea(),
        await tap(page, "Не знаю", explanation(realisticText)).then(paperArea),
      ]) {
        expect(result.background).toBe("rgba(0, 0, 0, 0)");
        expect(result.border).toBe("0px");
        expect(result.separation).toBeGreaterThanOrEqual(8);
      }
      await page.close();
    },
  );

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

    const before = await questionGeometry(page);
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

    // The steps and the text keep their place; the picked correct option is the only one left.
    const steps = await stepCount(page);
    const after = await questionGeometry(page);
    expect(after).toHaveLength(steps + 2);
    expect(after.slice(0, steps + 1)).toEqual(before.slice(0, steps + 1));
    expect(await requests(page)).toEqual(["q", "a7k:2"]);
    const text = await page.locator("#w").innerText();
    expect(text).toContain("Верно, +1 очко");
    expect(text).toContain("Синтетический разбор 1");
    expect(text).toContain("Синтетический вопрос 1");
    expect(text).not.toContain("Синтетический вариант 1");
    expect(text).toContain("Синтетический вариант 2");
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
    expect(text).toContain("Бот не ответил");
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

  it.each(['{"0":"h"}', '"hello"', "5", "null", "true"])(
    "shows the retry state for the answer %s, which is JSON and not a screen",
    async (answer) => {
      const page = await openWidget(320);
      await queueAnswer(page, answer);

      await page.getByRole("button", { name: "Проверить себя" }).click();

      await page.getByRole("button", { name: "Повторить" }).waitFor();
      await page.close();
    },
  );

  it.each(['{"0":"h"}', '"hello"', "5", "null"])(
    "draws an empty home screen for the chat state %s, which is JSON and not a screen",
    async (chatData) => {
      const page = await openWidget(320, { chatData });

      expect(await page.locator("#w").innerText()).toContain("Серия: 0 дней");
      await page.close();
    },
  );

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

  it.each([0, 1, 2] as const)(
    "shows only Rating navigation, ignoring retired preference %s",
    async (legacy) => {
      const page = await openWidget(320);
      try {
        await tap(page, "Рейтинг", ["l", 0, legacy, [[1, "Анна", 5, 1]]]);
        expect(await page.getByRole("button").allInnerTexts()).toEqual([
          "←",
          "Неделя",
          "Всё время",
        ]);
        expect(await page.locator("#w").innerText()).not.toContain(
          "Показывать меня",
        );
        await tap(page, "Всё время", ["l", 1, 1, [[1, "Анна", 5, 1]]]);
        expect(await requests(page)).toEqual(["l0", "l1"]);
      } finally {
        await page.close();
      }
    },
  );

  it("lets the person like, dislike and clear a question without moving its options", async () => {
    const page = await openWidget(320);
    try {
      await tap(page, "Проверить себя", question(realisticText));
      expect(await buttonNamed(page, "Оценить").count()).toBe(0);
      const geometry = await questionGeometry(page);
      await tap(page, "Не знаю", explanation(realisticText));
      await buttonNamed(page, "Оценить").click();
      await tap(page, "👍", ["u", "1a2b3c", 1]);
      expect(await buttonNamed(page, "👍").getAttribute("class")).toContain(
        "P",
      );
      expect(await questionGeometry(page)).toEqual(geometry);
      await buttonNamed(page, "👍").click();
      await tap(page, "👎", ["u", "1a2b3c", 2]);
      expect(await buttonNamed(page, "👎").getAttribute("class")).toContain(
        "P",
      );
      await buttonNamed(page, "👎").click();
      await tap(page, "👎", ["u", "1a2b3c", 0]);
      expect(await buttonNamed(page, "Оценить").count()).toBe(1);
      expect((await requests(page)).slice(-3)).toEqual([
        "f1a2b3c:1",
        "f1a2b3c:2",
        "f1a2b3c:0",
      ]);
      expect(await questionGeometry(page)).toEqual(geometry);
    } finally {
      await page.close();
    }
  });

  it("gives topic choices the same complete outlined cards as the home menu", async () => {
    const page = await openWidget(320, { documentMode: "quirks" });
    const appearance = (element: HTMLElement | SVGElement) => {
      const style = getComputedStyle(element);
      return [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
        style.borderRadius,
        style.backgroundColor,
        style.boxShadow,
      ];
    };
    try {
      const expected = await buttonNamed(page, "Проверить себя").evaluate(
        appearance,
      );
      await tap(page, "Тренировка по теме", topics(realisticText));
      const choices = page.locator("button").filter({ hasText: "20 из 20" });
      expect(await choices.count()).toBe(3);
      for (const choice of await choices.all()) {
        const actual = await choice.evaluate(appearance);
        // Home cards have an orange lower edge; all four border widths and the ink shadow match.
        expect(actual).toEqual(expected);
      }
      const boxes = await choices.evaluateAll((elements) =>
        elements.map((el) => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
      );
      const [first, second, third] = boxes;
      if (!first || !second || !third)
        throw new Error("Expected three topic cards");
      expect(second.top - first.bottom).toBeGreaterThanOrEqual(8);
      expect(third.top - second.bottom).toBeGreaterThanOrEqual(8);
    } finally {
      await page.close();
    }
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
    ]);
    expect(sent.map((data) => parseTrainerWidgetRequest(data))).not.toContain(
      undefined,
    );
  });

  describe("a question with a context", () => {
    const context = realisticText(TRAINER_CONTEXT_MAX_CHARS);
    /** A question with several correct options whose condition is the context. */
    const asked: TrainerQuestionData = [
      "q",
      "7k",
      "Синтетическая тема",
      "Синтетический вопрос?",
      ["Первый", "Второй", "Третий"],
      1,
      "",
      5,
      null,
      0,
      1,
    ];

    it.each(TRAINER_WIDGET_CHECKED_WIDTHS_PX)(
      "shows a context at its limit on its own screen in a %i px bubble, in text of 13 px or more",
      async (width) => {
        const page = await openWidget(width);
        await tap(page, "Проверить себя", ["c", "7k", context]);

        const measured = await layout(page);
        expect(await page.locator("#w").innerText()).toContain(context);
        expect(await page.getByRole("button").allInnerTexts()).toEqual([
          "К вопросу",
        ]);
        expect(measured.overflowing).toEqual([]);
        expect(measured.fontSize).toBeGreaterThanOrEqual(13);
        expect(measured.height).toBeLessThanOrEqual(
          TRAINER_WIDGET_TARGET_HEIGHT_PX,
        );
        await page.close();
      },
    );

    it("asks for the question after the context and for the context again from the question", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", ["c", "7k", context]);

      await tap(page, "К вопросу", asked);
      expect(await page.locator("#w").innerText()).toContain(
        "Синтетический вопрос?",
      );
      // The way back to the context is a button of the full touch size.
      expect(
        (await buttonNamed(page, "Условие").boundingBox())?.height,
      ).toBeGreaterThanOrEqual(44);
      await tap(page, "Условие", ["c", "7k", context]);

      expect(await page.locator("#w").innerText()).toContain(context);
      expect(await requests(page)).toEqual(["q", "o7k", "c7k"]);
      expect(
        (await requests(page)).map((data) => parseTrainerWidgetRequest(data)),
      ).not.toContain(undefined);
      await page.close();
    });

    it("keeps the picked options while the person reads the context again", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", ["c", "7k", context]);
      await tap(page, "К вопросу", asked);
      await buttonNamed(page, "Б ").click();

      await tap(page, "Условие", ["c", "7k", context]);
      await tap(page, "К вопросу", asked);

      expect(
        await page
          .locator(".op.S")
          .evaluateAll((picked) => picked.map((option) => option.textContent)),
      ).toEqual(["БВторой"]);
      await tap(page, "Ответить", ["e", 0, 1, 2, "Разбор.", "0", 5, 0]);
      expect((await requests(page)).at(-1)).toBe("a7k:2");
      await page.close();
    });

    it("shows the stored pick of a reviewed Daily question after its context is read again", async () => {
      const page = await openWidget(320);
      // The person answered «Б» earlier; the review carries that pick.
      const review: TrainerQuestionData = [
        "q",
        "7k",
        "Синтетическая тема",
        "Синтетический вопрос?",
        ["Первый", "Второй", "Третий"],
        0,
        "",
        1,
        0b010,
        1,
        1,
      ];
      const pickedOptions = () =>
        page
          .locator(".op.S")
          .evaluateAll((picked) => picked.map((option) => option.textContent));
      await tap(page, "Вопрос дня", ["c", "7k", context]);
      await tap(page, "К вопросу", review);
      expect(await pickedOptions()).toEqual(["БВторой"]);

      await tap(page, "Условие", ["c", "7k", context]);
      await tap(page, "К вопросу", review);

      expect(await pickedOptions()).toEqual(["БВторой"]);
      expect(await page.locator("#w").innerText()).toContain("Ответ сохранён");
      await page.close();
    });

    it("offers no context for a question without one", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", question(realisticText));

      await expect(buttonNamed(page, "Условие").count()).resolves.toBe(0);
      await page.close();
    });

    it("keeps the text and the correct option of a question with a context after the answer", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", ["c", "7k", context]);
      await tap(page, "К вопросу", asked);
      const before = await questionGeometry(page);

      await tap(page, "Не знаю", ["e", 3, 1, 0, "Разбор.", "0", 5, 0]);

      expect(await questionGeometry(page)).toEqual(
        before.slice(0, (await stepCount(page)) + 2),
      );
      // The context stays one tap away after the answer.
      await expect(buttonNamed(page, "Условие").count()).resolves.toBe(1);
      await page.close();
    });

    it.each([
      [320, 30, 400],
      [320, 100, 330],
      [320, 0, 400],
      [390, 30, 400],
      [390, 100, 330],
    ] as const)(
      "fits a question of the new limits in a %i px bubble: text %i, options %i characters",
      async (width, textLength, optionsLength) => {
        const page = await openWidget(width);
        const [screen, issueId, topic, text, options, several, marks, total] =
          question(realisticText, undefined, [textLength, optionsLength]);
        await tap(page, "Проверить себя", [
          screen,
          issueId,
          topic,
          text,
          options,
          several,
          marks,
          total,
          null,
          0,
          1,
        ]);

        const measured = await layout(page);
        expect(measured.overflowing).toEqual([]);
        expect(measured.fontSize).toBeGreaterThanOrEqual(12);
        expect(measured.height).toBeLessThanOrEqual(
          TRAINER_WIDGET_TARGET_HEIGHT_PX,
        );
        await tap(page, "Не знаю", explanation(realisticText));
        expect((await layout(page)).height).toBeLessThanOrEqual(
          TRAINER_WIDGET_TARGET_HEIGHT_PX,
        );
        await page.close();
      },
    );
  });

  describe("an explanation in parts", () => {
    const parts = trainerExplanationParts(
      realisticText(TRAINER_EXPLANATION_MAX_CHARS),
    );
    const part = (index: number): TrainerExplanationData => [
      "e",
      0,
      0b0011,
      0b1100,
      parts[index] ?? "",
      "10100",
      10,
      index === parts.length - 1 ? "Верно ответили 50% из 2 человек" : 0,
      0,
      index,
      parts.length,
    ];
    /** Turns the pages of the shown part to its end; the texts it showed, in order. */
    async function readToTheEnd(page: Page): Promise<string> {
      let text = "";
      for (let turn = 0; turn < 40; turn += 1) {
        text += (await page.locator(".fb .W").textContent()) ?? "";
        const sent = (await requests(page)).length;
        const next = buttonNamed(page, "→");
        if (await next.isDisabled()) return text;
        await next.click();
        // The last page of a part asks the bot for the next part instead of turning.
        if ((await requests(page)).length > sent) return text;
      }
      throw new Error("The explanation did not end in 40 pages");
    }

    it("is two parts at the limit of the explanation", () => {
      expect(parts).toHaveLength(2);
    });

    it("turns the pages of a part, then asks the bot for the next part and shows it to its end", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", question(realisticText));
      await tap(page, "Не знаю", part(0));
      await queueAnswer(page, encodeTrainerWidgetData(part(1)));

      const first = await readToTheEnd(page);
      await page.waitForFunction(
        `document.querySelector("#w").className === ""`,
      );
      const second = await readToTheEnd(page);

      expect(first).toBe(parts[0]);
      expect(second).toBe(`${parts[1] ?? ""} Верно ответили 50% из 2 человек`);
      expect((await requests(page)).slice(-1)).toEqual(["m1a2b3c:1"]);
      expect(
        parseTrainerWidgetRequest((await requests(page)).at(-1) ?? ""),
      ).toEqual({ kind: "explanation_part", issueId: "1a2b3c", part: 1 });
      expect((await layout(page)).height).toBeLessThanOrEqual(
        TRAINER_WIDGET_TARGET_HEIGHT_PX,
      );
      await page.close();
    });

    it("counts the pages of every part in one counter beside the verdict", async () => {
      const page = await openWidget(320);
      // A short question: after the answer each part of the explanation fits one page.
      await tap(page, "Проверить себя", [
        "q",
        "1a2b3c",
        "Тема",
        "Вопрос?",
        ["Первый", "Второй"],
        0,
        "",
        5,
      ]);
      await tap(page, "А Первый", part(0));
      expect(await pageCounter(page)).toBe("1/2");

      await tap(page, "→", part(1));

      // The second part is the second page of two, not the first page of one.
      expect(await pageCounter(page)).toBe("2/2");
      await expect(buttonNamed(page, "→").isDisabled()).resolves.toBe(true);
      await page.close();
    });

    it("returns from the first page of a part to the part before it", async () => {
      const page = await openWidget(320);
      await tap(page, "Проверить себя", question(realisticText));
      await tap(page, "Не знаю", part(1));

      await tap(page, "←", part(0));

      expect((await requests(page)).at(-1)).toBe("m1a2b3c:0");
      expect(await page.locator(".fb .W").textContent()).toBe(
        (parts[0] ?? "").slice(
          0,
          (await page.locator(".fb .W").textContent())?.length,
        ),
      );
      // The first page of the first part has nothing before it.
      await expect(buttonNamed(page, "←").isDisabled()).resolves.toBe(true);
      await page.close();
    });
  });

  it("marks every request with the generation of the widget", async () => {
    const page = await openWidget(320);
    await tap(page, "Прогресс", progress(realisticText));
    await tap(page, "←", home);

    expect(
      z.array(z.string()).parse(await page.evaluate("widgetRequests")),
    ).toEqual(["2p", "2h"]);
    await page.close();
  });

  describe("in «Тренировка по теме»", () => {
    /** Nine topics as the bot sends them: names of the limit length and the person's counters. */
    const nineTopics: TrainerWidgetData = [
      "t",
      Array.from({ length: 3 }, (_, index) => [
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
      for (const index of [0, 1, 2]) {
        const row = rows.find((each) =>
          each.includes(realisticText(TRAINER_TOPIC_NAME_MAX_CHARS, index)),
        );
        expect(row).toContain(`${String(index * 2)} из 20`);
      }
      const measured = await layout(page);
      expect(measured.overflowing).toEqual([]);
      expect(measured.clippedShadows).toEqual([]);
      expect(measured.pageWidth).toBe(320);
      expect(measured.fontSize).toBeGreaterThanOrEqual(11);
      expect(measured.fontSize).toBeLessThanOrEqual(15);
      expect(measured.height).toBeLessThanOrEqual(560);

      await tap(
        page,
        realisticText(TRAINER_TOPIC_NAME_MAX_CHARS, 2),
        question(realisticText),
      );
      expect(await requests(page)).toEqual(["t", "tt3"]);
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
        .locator("#w .st i")
        .evaluateAll((marks) =>
          marks.map((mark) => mark.getAttribute("class") ?? ""),
        );
    /** The options on the screen with their mark: G correct, B picked and wrong. */
    const options = (page: Page): Promise<string[]> =>
      page
        .locator("#w .op")
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
      expect(await buttons(page)).toEqual(["×", "Оценить", "Готово"]);
      await tap(page, "Готово", home);
      await tap(page, "Проверить себя", ["i", "Вопросы скоро появятся."]);
      expect(await buttons(page)).toEqual(["На главный"]);
      expect(await page.locator("#w").innerText()).not.toContain(
        "Бот не ответил",
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
      expect(await buttons(page)).toEqual(["×", "Оценить", "К итогу"]);
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

    it("keeps the question with the correct and the picked options after an answer", async () => {
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
      expect(text).toContain("Синтетическая тема");
      expect(text).toContain("Синтетический вопрос");
      expect(text).toContain("Неверно");
      expect(text).toContain("Синтетический разбор");
      // The other wrong options leave the screen: their room goes to the explanation.
      expect(await options(page)).toEqual([
        "АСинтетический вариант 1 G",
        "ВСинтетический вариант 3 B",
      ]);
      expect(text.indexOf("Синтетический вопрос")).toBeLessThan(
        text.indexOf("Синтетический вариант 1"),
      );
      expect(text.indexOf("Синтетический вариант 3")).toBeLessThan(
        text.indexOf("Неверно"),
      );
      expect(await page.locator("button.op").count()).toBe(0);
      expect(await steps(page)).toEqual(["G", "B", "B", "S", ""]);
      expect(text).not.toMatch(/Где почитать|В вопросе ошибка/);
      expect(await buttons(page)).toEqual(["×", "Оценить", "Дальше"]);
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
      expect(text).toContain("Бот не ответил");
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

      expect(await page.locator("#w").innerText()).toContain("Бот не ответил");
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
