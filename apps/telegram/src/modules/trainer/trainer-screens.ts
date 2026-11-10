import type {
  TrainerAnswerOutcome,
  TrainerIssuedQuestion,
  TrainerRoundResult,
} from "./trainer-rounds.js";
import type {
  TrainerExplanationData,
  TrainerQuestionData,
  TrainerResultData,
  TrainerVerdict,
} from "./widget/trainer-widget-wire.js";

// The widget screens of a round, built from what the bot has stored. Nothing here decides a
// rule: the numbers come from TrainerRounds.

const CHECK_TITLE = "Проверить себя";

/** A question screen: the texts and the round steps, never the correct options. */
export function questionScreen(
  question: TrainerIssuedQuestion,
): TrainerQuestionData {
  return [
    "q",
    question.issueId,
    question.topicName,
    question.text,
    question.options,
    question.severalCorrect ? 1 : 0,
    question.round.marks,
    question.round.size,
  ];
}

/** The screen after an answer: the verdict, the correct options and the explanation. */
export function explanationScreen(
  outcome: TrainerAnswerOutcome,
): TrainerExplanationData {
  return [
    "e",
    verdictOf(outcome),
    outcome.correctMask,
    outcome.pickedMask,
    outcome.explanation,
    outcome.round.marks,
    outcome.round.size,
    // The ready statistics line belongs to the Daily question.
    0,
  ];
}

/** Points are not counted yet, so a correct answer is always "correct without a point". */
function verdictOf(outcome: TrainerAnswerOutcome): TrainerVerdict {
  if (outcome.pickedMask === 0) return 3;
  return outcome.correct ? 1 : 0;
}

/** The result of a finished round. Points, the Series and the week place are not counted yet. */
export function resultScreen(result: TrainerRoundResult): TrainerResultData {
  const { round, correct } = result;
  return [
    "r",
    CHECK_TITLE,
    correct,
    round.size,
    resultComment(correct, round.size),
    0,
    0,
    0,
    round.mode === "topic" ? 1 : 0,
  ];
}

function resultComment(correct: number, total: number): string {
  if (correct === total) return "Все ответы верные.";
  if (correct * 2 >= total)
    return "Хороший результат. Разборы помогут закрыть пробелы.";
  return "Есть что повторить. Попробуйте ещё раунд.";
}
