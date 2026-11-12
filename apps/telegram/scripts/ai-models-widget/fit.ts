import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { type Browser, chromium, type Page } from "@playwright/test";

import {
  readAiModelsReferenceFile,
  type AiModelsReference,
} from "../../src/modules/ai-models/ai-models-reference-file.js";
import { formatAiModelsWidgetRequest } from "../../src/modules/ai-models/widget/ai-models-widget-request.js";
import {
  aiModelsChatData,
  aiModelsRequests,
  aiModelsResponse,
  encodeAiModelsWidgetData,
} from "../../src/modules/ai-models/widget/ai-models-widget-wire.js";
import {
  TELEGRAM_WIDGET_FIT_WIDTHS_PX,
  TELEGRAM_WIDGET_SMALLEST_FONT_PX,
  TELEGRAM_WIDGET_TARGET_HEIGHT_PX,
  TELEGRAM_WIDGET_TIME_BAND_PX,
  utf8ByteLength,
} from "../../src/modules/outbound/telegram-widget-limits.js";
import {
  widgetPage,
  type WidgetPageOptions,
} from "../../test/widget/widget-harness.js";
import { buildAiModelsWidgetHtml } from "./build.js";

// Draws every screen of a Справочник file in the built ИИ-модели widget and measures it: every
// page of every filter, both tabs of every card and «О данных». The import checks the bytes of
// every answer; only a drawn screen shows whether it fits 560 px. The owner runs this on the
// real file before importing it.
//
// The output names screens by their widget requests, which carry model codes, and gives numbers
// only: no text of the file is printed. A browser is not a Telegram app: it draws with its own
// fonts.

export interface AiModelsScreenFit {
  /** The widget request of the screen, mark included, such as `3lp0` or `3mopus`. */
  readonly request: string;
  readonly widthPx: number;
  /** The answer as the bot sends it. */
  readonly bytes: number;
  readonly heightPx: number;
  /** The text size of the screen after the widget fitted it. */
  readonly fontPx: number;
  /** The summaries of the list end in an ellipsis: the page did not fit with them whole. */
  readonly clipped: boolean;
  /** Some element leaves the bubble sideways. */
  readonly overflow: boolean;
  readonly fits: boolean;
}

/** The built widget in the stand-in Telegram app, the first page of «Мощные» as its chat state. */
export function aiModelsWidgetPage(
  reference: AiModelsReference,
  options: Partial<WidgetPageOptions> = {},
): Promise<string> {
  return widgetPage(buildAiModelsWidgetHtml(), {
    chatData: encodeAiModelsWidgetData(aiModelsChatData(reference)),
    safeAreaBottomPx: TELEGRAM_WIDGET_TIME_BAND_PX,
    ...options,
  });
}

/**
 * Shows `answer` in a widget just opened on `html`: the first page comes with the message, and
 * any other screen is the bot's answer to a tap on «Мощные». The widget draws whatever the bot
 * answers, so the screen is the one a person reaches by their own taps.
 */
export async function showAiModelsScreen(
  page: Page,
  html: string,
  answer: string | undefined,
): Promise<void> {
  await page.setContent(html);
  if (
    await page.evaluate(() => Reflect.get(window, "fixedFontLoaded") === false)
  )
    throw new Error("The fixed font was not ready before the widget");
  if (answer === undefined) return;
  await page.evaluate(`widgetAnswers.push(${JSON.stringify(answer)})`);
  await page.getByRole("button", { name: "Мощные" }).click();
  await page.waitForFunction(
    `widgetRequests.length > 0 && document.querySelector("#w").className === ""`,
  );
}

/** Height, text size, cut summaries and sideways overflow of the screen on view. */
export const measureAiModelsScreen = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("#w");
    if (!root) throw new Error("The widget root is missing");
    const width = document.documentElement.clientWidth;
    return {
      heightPx: document.body.offsetHeight,
      fontPx: Number.parseFloat(getComputedStyle(root).fontSize),
      clipped: root.querySelector(".Z") !== null,
      overflow:
        document.documentElement.scrollWidth > width ||
        [...root.querySelectorAll("*")].some((element) => {
          const box = element.getBoundingClientRect();
          // A summary cut with an ellipsis hides what goes past its end.
          return (
            element.parentElement?.closest(".Z") == null &&
            (box.left < 0 || box.right > width + 0.5)
          );
        }),
    };
  });

/** Measures every screen of an accepted Справочник at each checked width. */
export async function aiModelsReferenceFit(
  reference: AiModelsReference,
  options: {
    /** The owner's command measures with the machine's fonts; checks fix the font (#2026). */
    readonly fixedFont?: boolean;
    /** A browser the caller owns; without one the command starts Chromium. */
    readonly browser?: Browser;
    /** The theme and the document mode of the stand-in Telegram app. */
    readonly page?: Partial<WidgetPageOptions>;
  } = {},
): Promise<AiModelsScreenFit[]> {
  const html = await aiModelsWidgetPage(reference, {
    ...options.page,
    ...(options.fixedFont === true ? { fixedFont: true } : {}),
  });
  const first = formatAiModelsWidgetRequest({
    kind: "list",
    filter: "p",
    page: 0,
  });
  const browser = options.browser ?? (await chromium.launch());
  try {
    const fits: AiModelsScreenFit[] = [];
    for (const widthPx of TELEGRAM_WIDGET_FIT_WIDTHS_PX) {
      const page = await browser.newPage({
        viewport: { width: widthPx, height: TELEGRAM_WIDGET_TARGET_HEIGHT_PX },
      });
      for (const request of aiModelsRequests(reference)) {
        const data = aiModelsResponse(reference, request);
        if (data === undefined)
          throw new Error("Every request of the Справочник has an answer");
        const answer = encodeAiModelsWidgetData(data);
        const text = formatAiModelsWidgetRequest(request);
        await showAiModelsScreen(
          page,
          html,
          text === first ? undefined : answer,
        );
        const drawn = await measureAiModelsScreen(page);
        fits.push({
          request: text,
          widthPx,
          bytes: utf8ByteLength(answer),
          ...drawn,
          fits:
            drawn.heightPx <= TELEGRAM_WIDGET_TARGET_HEIGHT_PX &&
            drawn.fontPx >= TELEGRAM_WIDGET_SMALLEST_FONT_PX &&
            !drawn.overflow,
        });
      }
      await page.close();
    }
    return fits;
  } finally {
    if (options.browser === undefined) await browser.close();
  }
}

/** Where the command writes: the report lines and the remarks about the run. */
export interface AiModelsFitOutput {
  readonly report: (line: string) => void;
  readonly remark: (line: string) => void;
}

/**
 * The command: measures the Справочник file at `filePath` and writes one report line per screen
 * and width. Its exit code: 0 every screen fits, 1 some do not, 2 the file is unusable.
 */
export async function aiModelsWidgetFitCommand(
  filePath: string | undefined,
  output: AiModelsFitOutput,
): Promise<number> {
  if (filePath === undefined) {
    output.remark(
      "Usage: pnpm --filter @inside/telegram ai-models:widget:fit <Справочник file>",
    );
    return 2;
  }
  let input: unknown;
  try {
    input = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    // The parser's message quotes the file around the error: it is not printed.
    output.remark("The Справочник file cannot be read as JSON.");
    return 2;
  }
  const read = readAiModelsReferenceFile(input);
  if (read.status === "rejected") {
    for (const error of read.errors) output.report(JSON.stringify(error));
    output.remark(
      `The Справочник file is rejected by the import check: ${String(read.errors.length)} errors.`,
    );
    return 2;
  }
  const fits = await aiModelsReferenceFit(read.reference);
  for (const fit of fits) output.report(JSON.stringify(fit));
  const failed = fits.filter(({ fits }) => !fits).length;
  for (const widthPx of TELEGRAM_WIDGET_FIT_WIDTHS_PX) {
    const at = fits.filter((fit) => fit.widthPx === widthPx);
    output.remark(
      `${String(widthPx)} px: ${String(at.length)} screens, the tallest ` +
        `${String(Math.max(...at.map(({ heightPx }) => heightPx)))} px, the smallest text ` +
        `${String(Math.min(...at.map(({ fontPx }) => fontPx)))} px, ` +
        `${String(at.filter(({ clipped }) => clipped).length)} with summaries cut.`,
    );
  }
  output.remark(
    `${String(failed)} screens do not fit ${String(TELEGRAM_WIDGET_TARGET_HEIGHT_PX)} px ` +
      `in text of ${String(TELEGRAM_WIDGET_SMALLEST_FONT_PX)} px or more without overflow.`,
  );
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2);
  process.exitCode = await aiModelsWidgetFitCommand(
    // pnpm runs the script in the package; the path is the caller's.
    file === undefined
      ? undefined
      : path.resolve(process.env["INIT_CWD"] ?? process.cwd(), file),
    {
      report: (line) => process.stdout.write(`${line}\n`),
      remark: (line) => process.stderr.write(`${line}\n`),
    },
  );
}
