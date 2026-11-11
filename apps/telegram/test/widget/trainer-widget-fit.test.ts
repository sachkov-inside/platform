import { describe, expect, it } from "vitest";

import { readTrainerBankFile } from "../../src/modules/trainer/trainer-bank-file.js";
import { trainerBankFit } from "../../scripts/trainer-widget/fit.js";
import { syntheticTrainerBank } from "../support/synthetic-trainer-bank.js";
import { realisticText, wideText } from "./trainer-widget-harness.js";

// The command the author runs on the private Bank: it draws each question in the built widget.
// Every text here is synthetic filler.

/** One topic with one question, changed by `shape` and passed through the import check. */
function accepted(
  shape: (
    question: ReturnType<typeof syntheticTrainerBank>["questions"][number],
  ) => void,
) {
  const bank = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  const [question] = bank.questions;
  const [topic] = bank.topics;
  if (!question || !topic) throw new Error("The synthetic Bank is empty");
  // The longest topic name, as the import counts the bytes of a question.
  topic.name = wideText(40);
  shape(question);
  const read = readTrainerBankFile(bank);
  if (read.status !== "valid")
    throw new Error(`The synthetic Bank is rejected: ${JSON.stringify(read)}`);
  return read.bank;
}
const fitOf = (bank: ReturnType<typeof accepted>) =>
  trainerBankFit(
    bank.questions,
    new Map(bank.topics.map(({ code, name }) => [code, name])),
  );

describe("trainer widget fit of a Bank file", () => {
  it("measures the context, the question and every explanation page of every answer", async () => {
    const fits = await fitOf(
      accepted((question) => {
        question.context = realisticText(500);
        question.text = realisticText(100);
        question.options.forEach((option, index) => {
          option.text = realisticText(80, index);
          option.explanation = realisticText(60, index);
        });
        question.explanation = realisticText(630);
      }),
    );

    expect(fits.map(({ widthPx }) => widthPx)).toEqual([320, 390]);
    for (const fit of fits) {
      expect(fit.id).toBe("q-t1-1");
      expect(fit.fits).toBe(true);
      expect(fit.context?.fontPx).toBeGreaterThanOrEqual(13);
      expect(fit.question.fontPx).toBeGreaterThanOrEqual(11);
      expect(fit.contextBytes).toBeLessThanOrEqual(1024);
      expect(fit.questionBytes).toBeLessThanOrEqual(1024);
      // «Не знаю» and each of the four options: every answer of a single-answer question.
      expect(fit.answers).toBe(5);
      // One option's explanation, a space and the general one: 691 characters in two parts.
      expect(fit.explanationCharacters).toBe(691);
      expect(fit.explanationParts).toBe(2);
      expect(fit.explanationPages).toBeGreaterThan(2);
      // Every page of every answer is drawn: more pages than the longest answer alone has.
      expect(fit.pages).toBeGreaterThan(fit.explanationPages * 4);
      expect(fit.answered.heightPx).toBeLessThanOrEqual(560);
      expect(fit.answered.fontPx).toBeGreaterThanOrEqual(11);
    }
    // The report names the question and carries numbers only.
    expect(JSON.stringify(fits)).not.toMatch(/[а-яё]/i);
  });

  it("reports a question the import accepts and the screen does not fit", async () => {
    // Text of the widest letters alone passes the byte check and overflows a 320 px bubble.
    const fits = await fitOf(
      accepted((question) => {
        question.text = wideText(200);
        question.options.forEach((option, index) => {
          option.text = wideText(58, index);
        });
        question.explanation = wideText(600);
      }),
    );

    expect(fits.find(({ widthPx }) => widthPx === 320)?.fits).toBe(false);
  });
});
