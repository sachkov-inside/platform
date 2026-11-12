import { type Browser, type Page, chromium, webkit } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AI_MODELS_WIDGET_TARGET_HEIGHT_PX,
  AI_MODELS_WIDGET_WIDTHS_PX,
  aiModelsReferenceFit,
  aiModelsWidgetPage,
  measureAiModelsScreen,
  showAiModelsScreen,
} from "../../scripts/ai-models-widget/fit.js";
import {
  readAiModelsReferenceFile,
  type AiModelsReference,
} from "../../src/modules/ai-models/ai-models-reference-file.js";
import { TELEGRAM_WIDGET_DATA_MAX_BYTES } from "../../src/modules/outbound/telegram-widget-limits.js";
import {
  aiModelsResponse,
  encodeAiModelsWidgetData,
  type AiModelsWidgetData,
  type AiModelsWidgetRequest,
} from "../../src/modules/ai-models/widget/ai-models-widget-wire.js";
import { syntheticAiModelsReference } from "../support/synthetic-ai-models-reference.js";
import {
  type WidgetPageOptions,
  type WidgetTheme,
  wideText,
} from "./trainer-widget-harness.js";

// The built ИИ-модели widget in a browser with a stand-in TelegramWidget that answers from a
// queue: every screen of the synthetic Справочник, the navigation between them and the fit rule.
// It proves the HTML the bot sends, not how a Telegram app draws it.

const NBSP = " ";
const TOO_OFTEN = "Слишком часто. Повторите через несколько секунд.";
const THEMES: readonly WidgetTheme[] = ["light", "dark"];

/** The synthetic Справочник as the import accepts it. */
function accepted(): AiModelsReference {
  const read = readAiModelsReferenceFile(syntheticAiModelsReference());
  if (read.status !== "valid") throw new Error(JSON.stringify(read.errors));
  return read.reference;
}
const reference = accepted();

/** The bot's answer to a request for the synthetic Справочник. */
function answer(request: AiModelsWidgetRequest): string {
  const data = aiModelsResponse(reference, request);
  if (!data) throw new Error(`No answer to ${JSON.stringify(request)}`);
  return encodeAiModelsWidgetData(data);
}
const list = (filter: "p" | "f" | "v" | "c", page = 0) =>
  answer({ kind: "list", filter, page });
const card = (model: string) => answer({ kind: "card", model });
const subscriptions = (model: string) =>
  answer({ kind: "subscriptions", model });

let browser: Browser;
let webkitBrowser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
  webkitBrowser = await webkit.launch();
});
afterAll(async () => {
  await browser.close();
  await webkitBrowser.close();
});

/** Opens the widget on a new message: the first page of «Мощные» is its chat state. */
async function openWidget(
  width = 320,
  options: Partial<WidgetPageOptions> = {},
  engine: Browser = browser,
): Promise<Page> {
  const page = await engine.newPage({
    viewport: { width, height: AI_MODELS_WIDGET_TARGET_HEIGHT_PX },
    colorScheme: options.theme ?? "light",
  });
  await page.setContent(
    await aiModelsWidgetPage(reference, { fixedFont: true, ...options }),
  );
  // The widget fits its text when its script runs: the fixed font must be ready by then.
  await expect(
    page.evaluate(() => Reflect.get(window, "fixedFontLoaded") === true),
  ).resolves.toBe(true);
  return page;
}

/** Runs a check on a widget page and closes it. */
async function withWidget(
  check: (page: Page) => Promise<void>,
  width?: number,
  options?: Partial<WidgetPageOptions>,
): Promise<void> {
  const page = await openWidget(width, options);
  try {
    await check(page);
  } finally {
    await page.close();
  }
}

// The page's own globals (the stand-in TelegramWidget and its queues) are reached with script
// text: they do not exist in the types of this Node.js project.
/** What the widget asked the bot, without the mark "3" every request starts with. */
const requests = async (page: Page): Promise<string[]> =>
  z
    .array(z.string().startsWith("3"))
    .parse(await page.evaluate("widgetRequests"))
    .map((request) => request.slice(1));
const text = (page: Page): Promise<string> => page.locator("#w").innerText();
const buttonNamed = (page: Page, name: string) =>
  page
    .getByRole("button", {
      name: new RegExp(
        `^${name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`,
      ),
    })
    .first();

/** Taps a button that asks the bot, answers with `data` and waits until it is drawn. */
async function tap(page: Page, button: string, data?: string): Promise<void> {
  const sent = (await requests(page)).length;
  if (data !== undefined)
    await page.evaluate(`widgetAnswers.push(${JSON.stringify(data)})`);
  await buttonNamed(page, button).click();
  await page.waitForFunction(
    `widgetRequests.length > ${String(sent)} && document.querySelector("#w").className === ""`,
  );
}
/** Taps a button the widget handles itself, such as «‹». */
const press = (page: Page, button: string) => buttonNamed(page, button).click();

/** The names of the models listed on the screen, group titles in place. */
const rows = (page: Page) =>
  page
    .locator("#w .rw b.F, #w .gh")
    .evaluateAll((elements) => elements.map((element) => element.textContent));
const chosen = (page: Page) => page.locator("#w .O").allInnerTexts();
const title = (page: Page) => page.locator("#w .U").innerText();

describe("ИИ-модели widget: the list", () => {
  it("draws the first page of «Мощные» from the chat state of the message without asking the bot", async () => {
    await withWidget(async (page) => {
      expect(await requests(page)).toEqual([]);
      expect(await page.evaluate("widgetResizeAnchor")).toBe("bottom");
      expect(await title(page)).toBe("ИИ-модели");
      expect(await chosen(page)).toEqual(["Мощные"]);
      expect(await rows(page)).toEqual([
        "Atlas 3 Pro",
        "Boreal 2",
        "Atlas 3 Mini",
        "Gale 4",
        "Cirrus 7",
        "Delta 1",
        "Echo 5 Flash",
      ]);
      const shown = await text(page);
      expect(shown).toContain("Проверено 12.11 ›");
      expect(shown).toContain("⭐ Мой выбор\nЦена/качество\nДёшево");
      expect(shown).toContain(
        "Atlas 3 Pro\nНевыгодноРиск банасамая сильная в примере, но дорогая",
      );
      expect(shown).toContain("1 из 2");
    });
  });

  it("paints Мощность with five dots and the last dot of the two leaders in gold", async () => {
    await withWidget(async (page) => {
      const dots = await page
        .locator("#w .rw .D")
        .evaluateAll((sets) =>
          sets.map((set) =>
            [...set.children]
              .map((dot) => (dot.className === "" ? "-" : dot.className))
              .join(""),
          ),
        );
      expect(dots).toEqual([
        "nnnnY",
        "nnnnY",
        "nnnnn",
        "nnnnn",
        "nnnn-",
        "nnn--",
        "nn---",
      ]);
    });
  });

  it("asks for the first page of «Мощные» when the message has no readable chat state", async () => {
    await withWidget(
      async (page) => {
        await page.waitForFunction(
          `document.querySelector("#w").className === ""`,
        );
        expect(await requests(page)).toEqual(["lp0"]);
        expect(await rows(page)).toHaveLength(7);
      },
      320,
      { chatData: null, answers: [list("p")] },
    );
  });

  it("turns the pages of a filter through the bot, its arrows closed at the ends", async () => {
    await withWidget(async (page) => {
      const back = page.getByRole("button", { name: "‹" });
      const forward = page.getByRole("button", { name: "›", exact: true });
      await expect(back.isDisabled()).resolves.toBe(true);

      await tap(page, "›", list("p", 1));

      expect(await requests(page)).toEqual(["lp1"]);
      expect(await rows(page)).toEqual(["Fjord 2 Max", "Halo 1 Lite"]);
      expect(await text(page)).toContain("2 из 2");
      await expect(forward.isDisabled()).resolves.toBe(true);

      await tap(page, "‹", list("p"));
      expect(await requests(page)).toEqual(["lp1", "lp0"]);
    });
  });

  it("shows «Дёшево» with the task price, the cheapest plan or «только API»", async () => {
    await withWidget(async (page) => {
      await tap(page, "Дёшево", list("c"));

      expect(await requests(page)).toEqual(["lc0"]);
      expect(await chosen(page)).toEqual(["Дёшево"]);
      const shown = await text(page);
      expect(shown).toContain(
        "Delta 1\n$0,12\nзадача\n⭐ Мой выборДля средних задачподписка от $10 · очень дешёвая, для простых задач",
      );
      expect(shown).toContain(
        "Echo 5 Flash\n$0,31\nзадача\nтолько API · дешёвая, только по API",
      );
    });
  });

  it("shows «Мой выбор» in the author's groups without repeating the favorite badge", async () => {
    await withWidget(async (page) => {
      await tap(page, "⭐ Мой выбор", list("f"));

      expect(await requests(page)).toEqual(["lf0"]);
      expect(await rows(page)).toEqual([
        "На каждый день",
        "Boreal 2",
        "Atlas 3 Mini",
        "Delta 1",
        "Дизайн и моушн",
        "Atlas 3 Mini",
        "Cirrus 7",
      ]);
      expect(await page.locator("#w .rw .bf").count()).toBe(0);
      expect(await text(page)).not.toContain("1 из 1");
    });
  });

  it("frames «Цена/качество» as independent measurements with the task price on the right", async () => {
    await withWidget(async (page) => {
      await tap(page, "Цена/качество", list("v"));

      const shown = await text(page);
      expect(shown).toContain(
        "Дёшево\nПо независимым замерам, без мнения автора\nDelta 1\n$0,12\n",
      );
      expect(shown).toMatch(
        /Мощность: рейтинг агентов Arena\. Цена: одна задача по API\. Здесь модели, которым нет замены сильнее и дешевле одновременно\.$/,
      );
    });
  });
});

describe("ИИ-модели widget: the card", () => {
  it("shows the tab «Главное»: facts, the author's opinion apart, tags, the agent and the notice", async () => {
    await withWidget(async (page) => {
      await tap(page, "Atlas 3 Pro", card("atlas-pro"));

      expect(await requests(page)).toEqual(["matlas-pro"]);
      expect(await chosen(page)).toEqual(["Главное"]);
      expect(await text(page)).toBe(
        [
          "‹",
          "Atlas 3 Pro",
          "Мощность",
          "Цена",
          "Главное",
          "Подписки",
          "API: $5 / $25 за 1 млн токенов · задача ≈ $6,20",
          "«самая сильная в примере, но дорогая»",
          "Мнение автора",
          "Невыгоднотратит много токенов на одну задачу",
          "Риск бана: высокийAtlas часто блокирует аккаунты",
          "кодагенты",
          "Лучший агент по замерам",
          "Atlas Code 1-е место в синтетическом замере",
          "Ещё: OpenCode по ключу API",
          "В Atlas Lite модель доступна только до 30.11",
        ].join("\n"),
      );
    });
  });

  it("shows the advice as plain text and an agent the company recommends", async () => {
    await withWidget(async (page) => {
      await tap(page, "Delta 1", card("delta"));
      const delta = await text(page);
      expect(delta).toContain(
        "Мнение автора\n⭐ Мой выбордешёвая модель на каждый день\nДля средних задачдля средних задач\nсоветую Multigate Go\n",
      );

      await press(page, "‹");
      await tap(page, "Echo 5 Flash", card("echo"));
      const echo = await text(page);
      expect(echo).not.toContain("Мнение автора");
      expect(echo).toContain(
        "Агент, который советует компания\nEcho CLI компания советует его первым\nЕщё: OpenCode",
      );
    });
  });

  it("switches the tabs through the bot and opens «Лучше взять», and «‹» walks back without asking", async () => {
    await withWidget(async (page) => {
      await tap(page, "Cirrus 7", card("cirrus-7"));
      expect(await text(page)).toContain(
        "Лучше взять: Boreal 2 ›, сильнее и дешевле",
      );

      await tap(page, "Подписки", subscriptions("cirrus-7"));
      expect(await chosen(page)).toEqual(["Подписки"]);
      await tap(page, "Главное", card("cirrus-7"));
      await tap(page, "Boreal 2 ›", card("boreal-2"));
      expect(await title(page)).toBe("Boreal 2");
      expect(await requests(page)).toEqual([
        "mcirrus-7",
        "scirrus-7",
        "mcirrus-7",
        "mboreal-2",
      ]);

      await press(page, "‹");
      expect(await title(page)).toBe("Cirrus 7");
      expect(await chosen(page)).toEqual(["Главное"]);
      await press(page, "‹");
      expect(await title(page)).toBe("ИИ-модели");
      expect(await chosen(page)).toEqual(["Мощные"]);
      expect(await requests(page)).toHaveLength(4);
    });
  });

  it("offers two models in «Лучше взять», each opening its own card", async () => {
    await withWidget(async (page) => {
      await tap(page, "›", list("p", 1));
      await tap(page, "Fjord 2 Max", card("fjord"));
      expect(await text(page)).toContain(
        "Мнение автора\nЛучше взять: Boreal 2 › или Delta 1 ›, они проверенные",
      );

      await tap(page, "Delta 1 ›", card("delta"));
      await press(page, "‹");
      await press(page, "‹");

      expect(await requests(page)).toEqual(["lp1", "mfjord", "mdelta"]);
      expect(await rows(page)).toEqual(["Fjord 2 Max", "Halo 1 Lite"]);
    });
  });

  it("shows the subscriptions by service: ban risk, Russian marks, estimates and the vendor's words", async () => {
    await withWidget(async (page) => {
      await tap(page, "Atlas 3 Pro", card("atlas-pro"));
      await tap(page, "Подписки", subscriptions("atlas-pro"));
      expect(await text(page)).toContain(
        [
          "Atlas Chat Риск бана: высокий · из России: нет · карта РФ: нет",
          "Lite · $20",
          "только по акции до 30.11",
          "Max · $100",
          "в 5 раз больше Lite",
          "Ultra · $200",
          `≈${NBSP}$4${NBSP}200 в месяц по API в 21 раз больше цены, на Pro половина лимита`,
        ].join("\n"),
      );

      await press(page, "‹");
      await tap(page, "Cirrus 7", card("cirrus-7"));
      await tap(page, "Подписки", subscriptions("cirrus-7"));
      expect(await text(page)).toContain(
        [
          "Cirrus Cloud · из России: да · карта РФ: да",
          "Starter–Pro · от $6",
          "20–200 тыс. кредитов в месяц",
          "Multigate · из России и карта РФ: нет данных",
          "Go · $10",
          "$15 в месяц по API в 1,5 раза больше цены, лимит OpenCode, скидка до 30.11",
        ].join("\n"),
      );

      await press(page, "‹");
      await tap(page, "Echo 5 Flash", card("echo"));
      await tap(page, "Подписки", subscriptions("echo"));
      expect(await text(page)).toContain("Подписок нет, только API");
    });
  });
});

describe("ИИ-модели widget: «О данных»", () => {
  it("opens from the check date with the full date and the lines, and «‹» returns to the list", async () => {
    await withWidget(async (page) => {
      await tap(page, "›", list("p", 1));
      await tap(page, "Проверено 12.11", answer({ kind: "about" }));

      expect(await text(page)).toBe(
        [
          "‹",
          "О данных",
          "Проверено 12.11.2026",
          "Мощность и цена задачи: синтетический рейтинг агентов",
          "Мощность: место в таблице агентов, каждая точка на 10 мест",
          "Замеры подписок: синтетический замер",
          "Значки, «Мой выбор» и «Лучше взять»: мнение автора",
        ].join("\n"),
      );

      await press(page, "‹");
      expect(await rows(page)).toEqual(["Fjord 2 Max", "Halo 1 Lite"]);
      expect(await requests(page)).toEqual(["lp1", "a"]);
    });
  });
});

describe("ИИ-модели widget: errors", () => {
  it("shows the bot's refusal with «Повторить», which repeats the same request", async () => {
    await withWidget(async (page) => {
      await tap(page, "Дёшево", encodeAiModelsWidgetData(["x", TOO_OFTEN]));
      expect(await text(page)).toBe(`‹\nИИ-модели\n${TOO_OFTEN}\nПовторить`);

      await tap(page, "Повторить", list("c"));

      expect(await requests(page)).toEqual(["lc0", "lc0"]);
      expect(await chosen(page)).toEqual(["Дёшево"]);
    });
  });

  it("returns from an error to the screen it covers, and a failed card is not a step back", async () => {
    await withWidget(async (page) => {
      await tap(
        page,
        "Atlas 3 Pro",
        encodeAiModelsWidgetData(["x", "Список моделей обновился."]),
      );
      await press(page, "‹");
      expect(await chosen(page)).toEqual(["Мощные"]);

      await tap(page, "Atlas 3 Pro", card("atlas-pro"));
      await tap(page, "Подписки", encodeAiModelsWidgetData(["x", TOO_OFTEN]));
      await press(page, "‹");
      expect(await title(page)).toBe("Atlas 3 Pro");
      expect(await chosen(page)).toEqual(["Главное"]);
      await press(page, "‹");
      expect(await title(page)).toBe("ИИ-модели");
      expect(await requests(page)).toEqual([
        "matlas-pro",
        "matlas-pro",
        "satlas-pro",
      ]);
    });
  });

  it.each([
    ["no answer in time", undefined],
    ["an answer it cannot read", "{}"],
    ["a screen it does not know", '["q",1]'],
    ["a screen with missing parts", '["m","atlas-pro"]'],
  ])("offers to repeat the request after %s", async (_name, data) => {
    await withWidget(async (page) => {
      await tap(page, "Дёшево", data);

      expect(await text(page)).toBe("‹\nИИ-модели\nБот не ответил.\nПовторить");
      await press(page, "‹");
      expect(await chosen(page)).toEqual(["Мощные"]);
    });
  });

  it("asks for the first page again after a chat state it cannot draw", async () => {
    await withWidget(
      async (page) => {
        expect(await text(page)).toBe("ИИ-модели\nБот не ответил.\nПовторить");

        await tap(page, "Повторить", list("p"));

        expect(await requests(page)).toEqual(["lp0"]);
        expect(await rows(page)).toHaveLength(7);
      },
      320,
      { chatData: '["l","p",0,1,"12.11",[5]]' },
    );
  });

  it("takes no second press while a request is in flight", async () => {
    await withWidget(async (page) => {
      // The request stays unanswered, as while the bot is still working on it.
      await page.evaluate(
        "TelegramWidget.request = (data) => { widgetRequests.push(data); return new Promise(() => {}); }",
      );

      await press(page, "Дёшево");
      await page.evaluate(
        "[...document.querySelectorAll('#w button')].forEach((button) => button.click())",
      );

      expect(await requests(page)).toEqual(["lc0"]);
    });
  });

  it("shows bot text as text, never as markup", async () => {
    await withWidget(
      async (page) => {
        expect(await page.locator("#w img, #w i.k").count()).toBe(0);
        expect(await text(page)).toContain(
          '<i class=k>Name</i>\n<img src=x onerror="g(0)"> & co',
        );
      },
      320,
      {
        chatData: encodeAiModelsWidgetData([
          "l",
          "p",
          0,
          1,
          "12.11",
          ['x1|<i class=k>Name</i>|3|0||||<img src=x onerror="g(0)"> & co'],
        ]),
      },
    );
  });
});

/** Screens wider than the bot can send: each text grows until the answer reaches 1 024 bytes. */
function largest(
  build: (length: number) => AiModelsWidgetData,
  maximum: number,
): string {
  for (let length = maximum; length > 0; length -= 1) {
    const data = JSON.stringify(build(length));
    if (Buffer.byteLength(data, "utf8") <= TELEGRAM_WIDGET_DATA_MAX_BYTES)
      return encodeAiModelsWidgetData(build(length));
  }
  throw new Error(
    `No length fits the answer ${JSON.stringify(build(1)).slice(0, 20)}`,
  );
}
const widest = (length: number, seed = 0) => wideText(length, seed);
const limitScreens: readonly (readonly [name: string, data: string])[] = [
  ...(["p", "f", "v", "c"] as const).map(
    (filter) =>
      [
        `a page of the filter ${filter}`,
        largest(
          (length) => [
            "l",
            filter,
            0,
            3,
            "12.11",
            [
              ...(filter === "f" ? [["g", widest(20)] as const] : []),
              ...Array.from(
                { length: 7 },
                (_, row) =>
                  `m${String(row)}|${widest(Math.min(length, 24), row)}|5|1|${filter === "f" ? "cmpwb" : "fcmpwb"}|${filter === "v" || filter === "c" ? "$10,14" : ""}|${filter === "c" ? "$1${NBSP}000" : ""}|${widest(length, row + 1)}`,
              ),
            ],
          ],
          50,
        ),
      ] as const,
  ),
  [
    "the tab «Главное»",
    largest(
      (length) => [
        "m",
        "m0",
        widest(24),
        5,
        1,
        5,
        `$10,50 / $100,50 за 1 млн токенов · задача ≈ $10,14`,
        widest(50),
        [
          ...["f", "c", "m", "p", "w", "bh"].map(
            (code, index) => [code, widest(length, index)] as const,
          ),
          ["", widest(length, 7)],
        ],
        [widest(30), "m1", widest(24, 1), "m2", widest(24, 2)],
        ["код", "тексты", "поиск и анализ", "агенты", "дёшево и много"],
        ["v", widest(24, 3), widest(50, 4), widest(90, 5)],
        widest(50, 6),
      ],
      60,
    ),
  ],
  // Six plans, as many as a model of the real Справочник has. A tab of nine plans or more with
  // estimates at the widest texts is taller than 560 px at 320 px even at 11 px: the fit command
  // finds such a model before the import.
  ...(
    [
      [2, 3],
      [1, 6],
    ] as const
  ).map(
    ([services, plans]) =>
      [
        `the tab «Подписки» with ${String(services)} services of ${String(plans)} plans`,
        largest(
          (length) => [
            "s",
            "m0",
            widest(24),
            5,
            1,
            5,
            Array.from({ length: services }, (_, service) => [
              widest(24, service),
              "h",
              "nu",
              Array.from(
                { length: plans },
                (_, plan) =>
                  `${widest(Math.min(length, 20), plan)} · от $1${NBSP}000|${plan % 2 === 1 ? "o" : "m"}|≈${NBSP}$10${NBSP}000|333 раза|${widest(length, plan)}|${widest(Math.min(length, 30), plan + 2)}|`,
              ),
            ]),
          ],
          50,
        ),
      ] as const,
  ),
  [
    "«О данных»",
    largest(
      (length) => [
        "a",
        "12.11.2026",
        Array.from({ length: 6 }, (_, line) => widest(length, line)),
      ],
      90,
    ),
  ],
];

describe("ИИ-модели widget: fitting a screen", () => {
  it("wraps the summaries whole while the page fits", async () => {
    await withWidget(async (page) => {
      const drawn = await measureAiModelsScreen(page);
      expect(drawn.clipped).toBe(false);
      expect(drawn.fontPx).toBe(15);
      expect(await text(page)).toContain("почти как Pro, но дешевле\nGale 4");
    }, 390);
  });

  it("cuts the summaries with an ellipsis first, and only then lowers the text", async () => {
    const page = await openWidget(320);
    try {
      const [, crowded] = limitScreens[3] ?? [];
      await showAiModelsScreen(page, await pageHtml(), crowded);
      const cut = await measureAiModelsScreen(page);
      expect(cut.clipped).toBe(true);
      expect(cut.heightPx).toBeLessThanOrEqual(560);

      // A larger text size of the app: the cut page is still too tall, so the text gets smaller.
      await showAiModelsScreen(
        page,
        await pageHtml({ textSizePx: 22 }),
        crowded,
      );
      const smaller = await measureAiModelsScreen(page);
      expect(smaller.clipped).toBe(true);
      expect(smaller.fontPx).toBeLessThan(22);
      expect(smaller.fontPx).toBeGreaterThanOrEqual(11);
      expect(smaller.heightPx).toBeLessThanOrEqual(560);
      expect(
        await page
          .locator("#w .l2")
          .first()
          .evaluate((line) => getComputedStyle(line).textOverflow),
      ).toBe("ellipsis");
    } finally {
      await page.close();
    }
  });

  it("never draws text below 11 px, however large the app's text size", async () => {
    const page = await openWidget(320);
    try {
      const [, crowded] = limitScreens[3] ?? [];
      await showAiModelsScreen(
        page,
        await pageHtml({ textSizePx: 60 }),
        crowded,
      );
      expect((await measureAiModelsScreen(page)).fontPx).toBe(11);
    } finally {
      await page.close();
    }
  });

  it("keeps the band of the message time below the last line and follows the content's height", async () => {
    for (const engine of [browser, webkitBrowser])
      for (const documentMode of ["standards", "quirks"] as const) {
        const page = await openWidget(
          320,
          { documentMode, safeAreaBottomPx: 32 },
          engine,
        );
        try {
          await tap(page, "Проверено 12.11", answer({ kind: "about" }));
          const sizes = await page.evaluate(() => ({
            body: document.body.offsetHeight,
            root: document.querySelector<HTMLElement>("#w")?.offsetHeight ?? 0,
          }));
          expect(sizes.body).toBe(sizes.root + 32);
          expect(sizes.body).toBeLessThan(400);
        } finally {
          await page.close();
        }
      }
  });

  /** The widget page with the fixed font and these options. */
  const pageHtml = (options: Partial<WidgetPageOptions> = {}) =>
    aiModelsWidgetPage(reference, { fixedFont: true, ...options });

  describe.each([
    ["Chromium", "standards"],
    ["Chromium", "quirks"],
    ["WebKit", "quirks"],
  ] as const)("in %s, %s mode", (engineName, documentMode) => {
    it.each(THEMES)(
      "fits every screen of the synthetic Справочник at 320 and 390 px in the %s theme",
      async (theme) => {
        const fits = await aiModelsReferenceFit(reference, {
          fixedFont: true,
          browser: engineName === "WebKit" ? webkitBrowser : browser,
          page: { theme, documentMode },
        });

        // Six list pages, both tabs of nine cards and «О данных» at each width.
        expect(fits).toHaveLength(2 * (6 + 2 * 9 + 1));
        for (const fit of fits) {
          expect(fit, fit.request).toMatchObject({ fits: true });
          expect(fit.fontPx).toBeGreaterThanOrEqual(11);
        }
      },
    );

    it.each(THEMES)(
      "fits screens with texts at the limit of the answer size in the %s theme",
      async (theme) => {
        const engine = engineName === "WebKit" ? webkitBrowser : browser;
        const html = await pageHtml({ theme, documentMode });
        for (const width of AI_MODELS_WIDGET_WIDTHS_PX) {
          const page = await engine.newPage({
            viewport: { width, height: AI_MODELS_WIDGET_TARGET_HEIGHT_PX },
          });
          try {
            for (const [name, data] of limitScreens) {
              await showAiModelsScreen(page, html, data);
              const drawn = await measureAiModelsScreen(page);
              expect(drawn.heightPx, name).toBeLessThanOrEqual(560);
              expect(drawn.fontPx, name).toBeGreaterThanOrEqual(11);
              expect(drawn.overflow, name).toBe(false);
            }
          } finally {
            await page.close();
          }
        }
      },
    );
  });
});
