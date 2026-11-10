import type {
  TrainerAnswerOutcome,
  TrainerIssuedQuestion,
  TrainerRoundResult,
} from "./trainer-rounds.js";
import type {
  OptionMask,
  TrainerExplanationData,
  TrainerQuestionData,
  TrainerResultData,
  TrainerVerdict,
} from "./widget/trainer-widget-wire.js";

// The widget screens of a round, built from what the bot has stored. Nothing here decides a
// rule: the numbers come from TrainerRounds.

const CHECK_TITLE = "Проверить себя";

/**
 * A question screen: the texts and the round steps, never the correct options. `reviewMask`
 * is given for a question the person has answered: the options the person picked.
 */
export function questionScreen(
  question: TrainerIssuedQuestion,
  reviewMask?: OptionMask,
): TrainerQuestionData {
  const screen = [
    "q",
    question.issueId,
    question.topicName,
    question.text,
    question.options,
    question.severalCorrect ? 1 : 0,
    question.round.marks,
    question.round.size,
  ] as const;
  return reviewMask === undefined ? screen : [...screen, reviewMask];
}

/**
 * The screen after an answer: the verdict, the correct options and the explanation. `stat` is
 * the ready line under the explanation of a Daily question, 0 for no line.
 */
export function explanationScreen(
  outcome: TrainerAnswerOutcome,
  stat: string | 0 = 0,
): TrainerExplanationData {
  return [
    "e",
    verdictOf(outcome),
    outcome.correctMask,
    outcome.pickedMask,
    outcome.explanation,
    outcome.round.marks,
    outcome.round.size,
    stat,
  ];
}

function verdictOf(outcome: TrainerAnswerOutcome): TrainerVerdict {
  if (outcome.pickedMask === 0) return 3;
  if (outcome.point) return 2;
  return outcome.correct ? 1 : 0;
}

/**
 * The result of a finished round with the points its answers earned, the person's Series and
 * their place in the Rating of the week (0 for a person the Rating does not show), under
 * `title`: the topic's name for a topic round, «Проверить себя» when absent.
 */
export function resultScreen(
  result: TrainerRoundResult,
  score: {
    readonly points: number;
    readonly streakDays: number;
    readonly weekPlace: number;
  },
  title: string = CHECK_TITLE,
): TrainerResultData {
  const { round, correct } = result;
  return [
    "r",
    title,
    correct,
    round.size,
    resultComment(correct, round.size),
    score.points,
    score.streakDays,
    score.weekPlace,
    round.mode === "topic" ? 1 : 0,
  ];
}

function resultComment(correct: number, total: number): string {
  if (correct === total) return "Все ответы верные.";
  if (correct * 2 >= total)
    return "Хороший результат. Разборы помогут закрыть пробелы.";
  return "Есть что повторить. Попробуйте ещё раунд.";
}
