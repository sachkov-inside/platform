// A synthetic Bank for tests: filler texts only. The real Bank lives outside this repository.

export interface SyntheticOption {
  text: string;
  correct: boolean;
  explanation: string;
}

export interface SyntheticQuestion {
  id: string;
  topic: string;
  format: "single" | "multiple";
  /** The situation shown on its own screen before the question; absent in most questions. */
  context?: string;
  text: string;
  options: SyntheticOption[];
  explanation: string;
  source: string;
  checkedAt: string;
}

export interface SyntheticBank {
  version: 1;
  topics: { code: string; name: string }[];
  questions: SyntheticQuestion[];
}

const LETTERS = ["А", "Б", "В", "Г"];

/** Question `q-<topic>-<n>`: the first option is correct, or the first two when `multiple`. */
export function syntheticQuestion(
  topic: string,
  number: number,
  format: "single" | "multiple" = "single",
): SyntheticQuestion {
  return {
    id: `q-${topic}-${String(number)}`,
    topic,
    format,
    text: `Синтетический вопрос ${String(number)} темы ${topic}`,
    options: LETTERS.map((letter, index) => ({
      text: `Вариант ${letter}`,
      correct: index === 0 || (format === "multiple" && index === 1),
      explanation: `Разбор ${letter}.`,
    })),
    explanation: "Общий разбор.",
    source: "Синтетический источник",
    checkedAt: "2026-10-01",
  };
}

/** Topics `t1`…`tN` in this order, each with questions 1…M; every third question is `multiple`. */
export function syntheticTrainerBank(
  size: { topics?: number; questionsPerTopic?: number } = {},
): SyntheticBank {
  const topics = Array.from({ length: size.topics ?? 2 }, (_, index) => ({
    code: `t${String(index + 1)}`,
    name: `Синтетическая тема ${String(index + 1)}`,
  }));
  return {
    version: 1,
    topics,
    questions: topics.flatMap(({ code }) =>
      Array.from({ length: size.questionsPerTopic ?? 3 }, (_, index) =>
        syntheticQuestion(
          code,
          index + 1,
          index % 3 === 2 ? "multiple" : "single",
        ),
      ),
    ),
  };
}
