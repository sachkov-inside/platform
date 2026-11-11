import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "@playwright/test";

import {
  readTrainerBankFile,
  trainerAnswerExplanation,
  trainerPossibleAnswers,
  type TrainerBankQuestion,
} from "../../src/modules/trainer/trainer-bank-file.js";
import { correctMaskOf } from "../../src/modules/trainer/trainer-rounds.js";
import {
  TRAINER_WIDGET_TARGET_HEIGHT_PX,
  TRAINER_WIDGET_CHECKED_WIDTHS_PX,
} from "../../src/modules/trainer/widget/trainer-widget-limits.js";
import {
  trainerContextDataBytes,
  trainerExplanationParts,
  trainerQuestionDataBytes,
  trainerTextLength,
  type TrainerExplanationData,
  type TrainerQuestionData,
  type TrainerWidgetData,
} from "../../src/modules/trainer/widget/trainer-widget-wire.js";
import { trainerWidgetPage } from "../../test/widget/trainer-widget-harness.js";

// Draws every question of a Bank file in the built widget and measures its screens: the
// context, the question, and every page of every part of the explanation of every answer the
// widget can send. The import checks the
// characters and the bytes of a question; only a drawn screen shows whether its text fits
// 560 px. The author runs this on the private Bank before publishing it.
//
// The output names questions by their identifiers and gives numbers only: no text of the
// Bank is printed. A browser is not a Telegram app: it draws with its own fonts.

/** The smallest text the widget may shrink to. */
const SMALLEST_FONT_PX = 11;
/** The narrowest bubble and a common phone; the layout is checked at both. */
const WIDTHS_PX = TRAINER_WIDGET_CHECKED_WIDTHS_PX.slice(0, 2);
const ISSUE_ID = "1a2b3c";

interface Measured {
  readonly fontPx: number;
  readonly heightPx: number;
}

export interface TrainerQuestionFit {
  readonly id: string;
  readonly widthPx: number;
  readonly contextBytes: number;
  readonly questionBytes: number;
  /** Absent for a question without a context. */
  readonly context?: Measured;
  readonly question: Measured;
  /** Answers checked: every one the widget can send, «Не знаю» included. */
  readonly answers: number;
  /** Pages of explanations checked: every page of every part of every answer. */
  readonly pages: number;
  /** The tallest and the smallest-text screen among all those pages. */
  readonly answered: Measured;
  /** The longest explanation among the answers: its characters, parts and pages. */
  readonly explanationCharacters: number;
  readonly explanationParts: number;
  readonly explanationPages: number;
  /** The page counter kept its total while the pages of every part were turned. */
  readonly steadyCounter: boolean;
  readonly fits: boolean;
}

const measure = (page: Page): Promise<Measured> =>
  page.evaluate(() => {
    const root = document.querySelector("#w");
    if (!root) throw new Error("The widget root is missing");
    return {
      fontPx: Number.parseFloat(getComputedStyle(root).fontSize),
      heightPx: document.body.offsetHeight,
    };
  });

/** Answers the widget's next request with `data` and taps the button that makes it. */
async function tap(
  page: Page,
  button: string,
  data: TrainerWidgetData,
): Promise<void> {
  await page.evaluate(
    `widgetAnswers.push(${JSON.stringify(JSON.stringify(data))})`,
  );
  const sent = Number(await page.evaluate("widgetRequests.length"));
  await page
    .getByRole("button", { name: new RegExp(`^${button}`) })
    .first()
    .click();
  await page.waitForFunction(
    `widgetRequests.length > ${String(sent)} && document.querySelector("#w").className === ""`,
  );
}

/** Shows the question on a fresh widget; the context first when it has one. */
async function ask(
  page: Page,
  html: string,
  question: TrainerBankQuestion,
  asked: TrainerQuestionData,
): Promise<{ context?: Measured; question: Measured }> {
  await page.setContent(html);
  if (question.context === undefined) {
    await tap(page, "Проверить себя", asked);
    return { question: await measure(page) };
  }
  await tap(page, "Проверить себя", ["c", ISSUE_ID, question.context]);
  const context = await measure(page);
  await tap(page, "К вопросу", asked);
  return { context, question: await measure(page) };
}

async function fitOf(
  page: Page,
  html: string,
  question: TrainerBankQuestion,
  topicName: string,
  widthPx: number,
): Promise<TrainerQuestionFit> {
  const options = question.options.map((option) => option.text);
  // The round is the longest one, as the import counts the bytes of a question.
  const round = [
    "q",
    ISSUE_ID,
    topicName,
    question.text,
    options,
    question.format === "multiple" ? 1 : 0,
    "1010",
    10,
  ] as const;
  const asked: TrainerQuestionData =
    question.context === undefined ? round : [...round, null, 0, 1];
  const correct = correctMaskOf(question.options);

  let shown: { context?: Measured; question: Measured } | undefined;
  let pages = 0;
  let tallest = 0;
  let smallest = Number.POSITIVE_INFINITY;
  let steadyCounter = true;
  const longest = { characters: 0, parts: 0, pages: 0 };
  const answers = trainerPossibleAnswers(question);
  for (const picked of answers) {
    shown = await ask(page, html, question, asked);
    const explanation = trainerAnswerExplanation(question, picked);
    const parts = trainerExplanationParts(explanation);
    const verdict = picked === 0 ? 3 : picked === correct ? 2 : 0;
    let turned = 0;
    for (const [index, text] of parts.entries()) {
      const whole = [
        "e",
        verdict,
        correct,
        picked,
        text,
        "10100",
        10,
        0,
      ] as const;
      const part: TrainerExplanationData =
        parts.length > 1 ? [...whole, 0, index, parts.length] : whole;
      // «Не знаю» delivers the first part whatever was picked: the widget draws the bot's
      // answer. The arrow at the end of a part asks for the next one.
      if (index === 0) await tap(page, "Не знаю", part);
      else await tap(page, "→", part);
      // Every page of the part is drawn and measured; the last one keeps its arrow for the
      // next part, or has it disabled.
      let total: string | undefined;
      for (;;) {
        const drawn = await measure(page);
        turned += 1;
        tallest = Math.max(tallest, drawn.heightPx);
        smallest = Math.min(smallest, drawn.fontPx);
        const counter = await page.evaluate(() =>
          /^(\d+)\/(\d+)$/.exec(
            document.querySelector(".fb span")?.textContent ?? "",
          ),
        );
        if (counter === null) break;
        // The widget fits every page before it shows the first: a total that changes
        // while the person reads means a page was refitted under their eyes.
        if (total !== undefined && total !== counter[2]) steadyCounter = false;
        total = counter[2];
        if (counter[1] === counter[2]) break;
        await page.getByRole("button", { name: /^→/ }).click();
      }
    }
    pages += turned;
    const characters = trainerTextLength(explanation);
    if (characters > longest.characters)
      Object.assign(longest, {
        characters,
        parts: parts.length,
        pages: turned,
      });
  }
  if (!shown) throw new Error(`Question ${question.id} has no answer to check`);

  const screens = [shown.context, shown.question].filter(
    (each) => each !== undefined,
  );
  return {
    id: question.id,
    widthPx,
    contextBytes:
      question.context === undefined
        ? 0
        : trainerContextDataBytes(question.context),
    questionBytes: trainerQuestionDataBytes({
      topic: topicName,
      text: question.text,
      options,
      context: question.context !== undefined,
    }),
    ...(shown.context === undefined ? {} : { context: shown.context }),
    question: shown.question,
    answers: answers.length,
    pages,
    answered: { fontPx: smallest, heightPx: tallest },
    explanationCharacters: longest.characters,
    explanationParts: longest.parts,
    explanationPages: longest.pages,
    steadyCounter,
    fits:
      steadyCounter &&
      tallest <= TRAINER_WIDGET_TARGET_HEIGHT_PX &&
      smallest >= SMALLEST_FONT_PX &&
      screens.every(
        (screen) =>
          screen.heightPx <= TRAINER_WIDGET_TARGET_HEIGHT_PX &&
          screen.fontPx >= SMALLEST_FONT_PX,
      ),
  };
}

/** Measures every question of an accepted Bank file at each checked width. */
export async function trainerBankFit(
  questions: readonly TrainerBankQuestion[],
  topicNames: ReadonlyMap<string, string>,
): Promise<TrainerQuestionFit[]> {
  // The band of the message time under the widget: the tallest one the layout is checked at.
  const html = await trainerWidgetPage({
    chatData: '["h",0,0,5,0]',
    safeAreaBottomPx: 32,
  });
  const browser = await chromium.launch();
  try {
    const fits: TrainerQuestionFit[] = [];
    for (const widthPx of WIDTHS_PX) {
      const page = await browser.newPage({
        viewport: { width: widthPx, height: TRAINER_WIDGET_TARGET_HEIGHT_PX },
      });
      for (const question of questions)
        fits.push(
          await fitOf(
            page,
            html,
            question,
            topicNames.get(question.topic) ?? "",
            widthPx,
          ),
        );
      await page.close();
    }
    return fits;
  } finally {
    await browser.close();
  }
}

/** Where the command writes: the report lines and the remarks about the run. */
export interface TrainerFitOutput {
  readonly report: (line: string) => void;
  readonly remark: (line: string) => void;
}

/**
 * The command: measures the Bank file at `bankPath` and writes one report line per question
 * and width. Its exit code: 0 every question fits, 1 some do not, 2 the file is unusable.
 */
export async function trainerWidgetFitCommand(
  bankPath: string | undefined,
  output: TrainerFitOutput,
): Promise<number> {
  if (bankPath === undefined) {
    output.remark(
      "Usage: pnpm --filter @inside/telegram trainer:widget:fit <Bank file>",
    );
    return 2;
  }
  let input: unknown;
  try {
    input = JSON.parse(await readFile(bankPath, "utf8"));
  } catch {
    // The parser's message quotes the file around the error: it is not printed.
    output.remark("The Bank file cannot be read as JSON.");
    return 2;
  }
  const read = readTrainerBankFile(input);
  if (read.status === "rejected") {
    for (const error of read.errors) output.report(JSON.stringify(error));
    output.remark(
      `The Bank file is rejected by the import check: ${String(read.errors.length)} errors.`,
    );
    return 2;
  }
  const { bank } = read;
  const fits = await trainerBankFit(
    bank.questions,
    new Map(bank.topics.map(({ code, name }) => [code, name])),
  );
  for (const fit of fits) output.report(JSON.stringify(fit));
  const failed = new Set(fits.filter(({ fits }) => !fits).map(({ id }) => id));
  const smallest = Math.min(...fits.map(({ question }) => question.fontPx));
  output.remark(
    `${String(bank.questions.length)} questions at ${WIDTHS_PX.join(" and ")} px: ` +
      `${String(fits.reduce((sum, { answers }) => sum + answers, 0))} answers and ` +
      `${String(fits.reduce((sum, { pages }) => sum + pages, 0))} explanation pages drawn; ` +
      `${String(failed.size)} questions do not fit ${String(TRAINER_WIDGET_TARGET_HEIGHT_PX)} px ` +
      `in text of ${String(SMALLEST_FONT_PX)} px or more; ` +
      `the smallest question text is ${String(smallest)} px.`,
  );
  return failed.size > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2);
  process.exitCode = await trainerWidgetFitCommand(
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
