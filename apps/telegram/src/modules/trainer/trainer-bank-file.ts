import { z } from "zod";
import { trainerCodeSchema, trainerCodeFormat } from "./trainer-identifiers.js";

import {
  TELEGRAM_WIDGET_DATA_MAX_BYTES,
  TRAINER_EXPLANATION_MAX_CHARS,
  TRAINER_OPTIONS_MAX,
  TRAINER_OPTIONS_MIN,
  TRAINER_OPTIONS_TOTAL_MAX_CHARS,
  TRAINER_QUESTION_MAX_CHARS,
  TRAINER_TOPIC_NAME_MAX_CHARS,
  TRAINER_TOPICS_MAX,
} from "./widget/trainer-widget-limits.js";
import {
  trainerExplanationDataBytes,
  trainerQuestionDataBytes,
  trainerTextLength,
  utf8ByteLength,
  type OptionMask,
} from "./widget/trainer-widget-wire.js";

// The Bank file is the contract between the private repository of questions and this bot.
// docs/integrations/trainer-bank-v1.md describes it for the author; the JSON Schema beside that
// document is generated from the schema below (`pnpm trainer:bank:schema`).

const text = z.string().min(1);

const topicSchema = z.strictObject({
  // A widget request carries the topic code: `t<code>`.
  code: trainerCodeSchema.describe(
    "Постоянный код темы. По нему вопросы ссылаются на тему.",
  ),
  name: text.describe("Название темы, как его видит человек."),
});

const optionSchema = z.strictObject({
  text: text.describe("Текст варианта."),
  correct: z.boolean().describe("Верный ли вариант."),
  explanation: text.describe(
    "Разбор варианта. Человек видит его после ответа, если выбрал этот вариант.",
  ),
});

const questionSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
    .describe(
      "Постоянный идентификатор вопроса. Не меняется при правке текста и не используется повторно.",
    ),
  topic: z.string().describe("Код темы из списка topics."),
  format: z
    .enum(["single", "multiple"])
    .describe(
      "single: ровно один верный вариант. multiple: не меньше двух верных вариантов.",
    ),
  text: text.describe("Текст вопроса."),
  options: z
    .array(optionSchema)
    .min(TRAINER_OPTIONS_MIN)
    .max(TRAINER_OPTIONS_MAX)
    .describe("Варианты в том порядке, в котором их видит человек."),
  explanation: text.describe(
    "Общий разбор. Человек видит его после любого ответа.",
  ),
  source: text.describe(
    "Источник, по которому проверен вопрос. Нужен автору, человеку не показывается.",
  ),
  checkedAt: z.iso
    .date()
    .describe("Дата проверки вопроса. Нужна автору, человеку не показывается."),
});

export const trainerBankFileSchema = z.strictObject({
  version: z.literal(1),
  topics: z
    .array(topicSchema)
    .min(1)
    .describe("Темы в том порядке, в котором их видит человек."),
  questions: z.array(questionSchema).min(1),
});

/**
 * Limits the file is checked against besides its shape. The published schema carries them, so
 * the private repository reads the same numbers the import uses.
 */
export const TRAINER_BANK_FILE_LIMITS = {
  topics: TRAINER_TOPICS_MAX,
  topicNameCharacters: TRAINER_TOPIC_NAME_MAX_CHARS,
  questionTextCharacters: TRAINER_QUESTION_MAX_CHARS,
  optionTextsTogetherCharacters: TRAINER_OPTIONS_TOTAL_MAX_CHARS,
  answerExplanationCharacters: TRAINER_EXPLANATION_MAX_CHARS,
  topicsDataBytes: TELEGRAM_WIDGET_DATA_MAX_BYTES,
  progressDataBytes: TELEGRAM_WIDGET_DATA_MAX_BYTES,
  questionDataBytes: TELEGRAM_WIDGET_DATA_MAX_BYTES,
  answerExplanationDataBytes: TELEGRAM_WIDGET_DATA_MAX_BYTES,
} as const;

export type TrainerBankFile = z.infer<typeof trainerBankFileSchema>;
export type TrainerBankQuestion = TrainerBankFile["questions"][number];
export type TrainerBankOption = TrainerBankQuestion["options"][number];

/** One reason the file is rejected. It names the place and never repeats the Bank's texts. */
export interface TrainerBankFileError {
  /** Question identifier, or `№<position in the file>` when the identifier itself is broken. */
  readonly question?: string;
  /** Topic code, or `№<position in the file>`. */
  readonly topic?: string;
  readonly field?: string;
  readonly reason: string;
}

export type TrainerBankFileResult =
  | { readonly status: "valid"; readonly bank: TrainerBankFile }
  | {
      readonly status: "rejected";
      readonly errors: readonly TrainerBankFileError[];
    };

/**
 * The explanation a person sees after an answer: the explanations of the picked options in the
 * file's order, then the general one. «Не знаю» (no option picked) shows the general one alone.
 */
export function trainerAnswerExplanation(
  question: Pick<TrainerBankQuestion, "options" | "explanation">,
  picked: OptionMask,
): string {
  return [
    ...question.options
      .filter((_, index) => (picked & (1 << index)) !== 0)
      .map((option) => option.explanation),
    question.explanation,
  ].join(" ");
}

/** Checks the whole file. Texts of an accepted bank are trimmed and composed (NFC). */
export function readTrainerBankFile(input: unknown): TrainerBankFileResult {
  const parsed = trainerBankFileSchema.safeParse(input, {
    error: z.locales.ru().localeError,
  });
  if (!parsed.success)
    return {
      status: "rejected",
      errors: parsed.error.issues.map((issue) => schemaError(input, issue)),
    };
  const bank = clean(parsed.data);
  const errors = [...topicErrors(bank), ...questionErrors(bank)];
  return errors.length > 0
    ? { status: "rejected", errors }
    : { status: "valid", bank };
}

function schemaError(
  input: unknown,
  issue: z.core.$ZodIssue,
): TrainerBankFileError {
  const [list, index, ...rest] = issue.path;
  const field = rest.length > 0 ? rest.map(String).join(".") : undefined;
  if ((list === "questions" || list === "topics") && typeof index === "number")
    return {
      [list === "questions" ? "question" : "topic"]: nameOf(input, list, index),
      ...(field === undefined ? {} : { field }),
      reason: issue.message,
    };
  return {
    ...(issue.path.length > 0
      ? { field: issue.path.map(String).join(".") }
      : {}),
    reason: issue.message,
  };
}

/** The author's own name of a broken entry, when the file has a usable one. */
function nameOf(
  input: unknown,
  list: "questions" | "topics",
  index: number,
): string {
  const key = list === "questions" ? "id" : "code";
  const entries: unknown = isRecord(input) ? input[list] : undefined;
  const entry: unknown = Array.isArray(entries) ? entries[index] : undefined;
  const name = isRecord(entry) ? entry[key] : undefined;
  return typeof name === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(name)
    ? name
    : `№${String(index + 1)}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const tidy = (value: string): string => value.normalize("NFC").trim();

function clean(bank: TrainerBankFile): TrainerBankFile {
  return {
    version: bank.version,
    topics: bank.topics.map((topic) => ({ ...topic, name: tidy(topic.name) })),
    questions: bank.questions.map((question) => ({
      ...question,
      text: tidy(question.text),
      options: question.options.map((option) => ({
        ...option,
        text: tidy(option.text),
        explanation: tidy(option.explanation),
      })),
      explanation: tidy(question.explanation),
      source: tidy(question.source),
    })),
  };
}

const EMPTY = "Текст пуст.";
const over = (what: string, unit: string, size: number, limit: number) =>
  `${what}: ${unit} ${String(size)}, лимит ${String(limit)}.`;

function topicErrors(bank: TrainerBankFile): TrainerBankFileError[] {
  const errors: TrainerBankFileError[] = [];
  if (bank.topics.length > TRAINER_TOPICS_MAX)
    errors.push({
      field: "topics",
      reason: `Тем в файле ${String(bank.topics.length)}, лимит ${String(TRAINER_TOPICS_MAX)}.`,
    });
  const topicsScreen = [
    "t",
    bank.topics.map(({ code, name }) => {
      const total = bank.questions.filter((q) => q.topic === code).length;
      return [code, name, total, total];
    }),
  ];
  const bytes = utf8ByteLength(JSON.stringify(topicsScreen));
  if (bytes > TELEGRAM_WIDGET_DATA_MAX_BYTES)
    errors.push({
      field: "topics",
      reason: over(
        "Экран тем",
        "байтов",
        bytes,
        TELEGRAM_WIDGET_DATA_MAX_BYTES,
      ),
    });
  const progressScreen = [
    "p",
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    bank.topics.map(({ code, name }) => {
      const total = bank.questions.filter((q) => q.topic === code).length;
      return [name, total, total, 100];
    }),
  ];
  const progressBytes = utf8ByteLength(JSON.stringify(progressScreen));
  if (progressBytes > TELEGRAM_WIDGET_DATA_MAX_BYTES)
    errors.push({
      field: "topics",
      reason: over(
        "Экран Прогресса",
        "байтов",
        progressBytes,
        TELEGRAM_WIDGET_DATA_MAX_BYTES,
      ),
    });
  const used = new Set(bank.questions.map(({ topic }) => topic));
  const seen = new Set<string>();
  for (const { code, name } of bank.topics) {
    if (!used.has(code))
      errors.push({
        topic: code,
        field: "code",
        reason: "У темы нет ни одного вопроса.",
      });
    if (seen.has(code))
      errors.push({
        topic: code,
        field: "code",
        reason: "Код темы повторяется в файле.",
      });
    seen.add(code);
    const length = trainerTextLength(name);
    if (length === 0)
      errors.push({ topic: code, field: "name", reason: EMPTY });
    if (length > TRAINER_TOPIC_NAME_MAX_CHARS)
      errors.push({
        topic: code,
        field: "name",
        reason: over(
          "Название темы",
          "знаков",
          length,
          TRAINER_TOPIC_NAME_MAX_CHARS,
        ),
      });
  }
  return errors;
}

function questionErrors(bank: TrainerBankFile): TrainerBankFileError[] {
  const topics = new Map(bank.topics.map(({ code, name }) => [code, name]));
  const seen = new Set<string>();
  return bank.questions.flatMap((question) => {
    const repeated = seen.has(question.id);
    seen.add(question.id);
    return [
      ...(repeated
        ? [
            {
              field: "id",
              reason: "Идентификатор вопроса повторяется в файле.",
            },
          ]
        : []),
      ...contentErrors(question, topics.get(question.topic)),
    ].map((error) => ({ question: question.id, ...error }));
  });
}

type FieldError = Pick<TrainerBankFileError, "field" | "reason">;

function contentErrors(
  question: TrainerBankQuestion,
  topicName: string | undefined,
): FieldError[] {
  const errors: FieldError[] = [];
  if (topicName === undefined)
    errors.push({
      field: "topic",
      reason: `Темы с кодом «${trainerCodeFormat.test(question.topic) ? question.topic : "…"}» нет в списке тем файла.`,
    });

  const texts = [
    ["text", question.text],
    ["explanation", question.explanation],
    ["source", question.source],
    ...question.options.flatMap((option, index) => [
      [`options.${String(index)}.text`, option.text],
      [`options.${String(index)}.explanation`, option.explanation],
    ]),
  ] as const;
  for (const [field, value] of texts)
    if (value === "") errors.push({ field, reason: EMPTY });

  const correct = question.options.filter((option) => option.correct).length;
  if (question.format === "single" && correct !== 1)
    errors.push({
      field: "options",
      reason: `Формат single требует ровно один верный вариант, в вопросе их ${String(correct)}.`,
    });
  if (question.format === "multiple" && correct < 2)
    errors.push({
      field: "options",
      reason: `Формат multiple требует не меньше двух верных вариантов, в вопросе их ${String(correct)}.`,
    });

  const textLength = trainerTextLength(question.text);
  if (textLength > TRAINER_QUESTION_MAX_CHARS)
    errors.push({
      field: "text",
      reason: over(
        "Текст вопроса",
        "знаков",
        textLength,
        TRAINER_QUESTION_MAX_CHARS,
      ),
    });
  const optionsLength = question.options.reduce(
    (sum, option) => sum + trainerTextLength(option.text),
    0,
  );
  if (optionsLength > TRAINER_OPTIONS_TOTAL_MAX_CHARS)
    errors.push({
      field: "options",
      reason: over(
        "Варианты вместе",
        "знаков",
        optionsLength,
        TRAINER_OPTIONS_TOTAL_MAX_CHARS,
      ),
    });
  const questionBytes = trainerQuestionDataBytes({
    // An unknown topic is already reported; the longest allowed name keeps this check honest.
    topic: topicName ?? "ж".repeat(TRAINER_TOPIC_NAME_MAX_CHARS),
    text: question.text,
    options: question.options.map((option) => option.text),
  });
  if (
    textLength <= TRAINER_QUESTION_MAX_CHARS &&
    optionsLength <= TRAINER_OPTIONS_TOTAL_MAX_CHARS &&
    questionBytes > TELEGRAM_WIDGET_DATA_MAX_BYTES
  )
    errors.push({
      field: "text",
      reason:
        over(
          "Данные вопроса для виджета",
          "байт",
          questionBytes,
          TELEGRAM_WIDGET_DATA_MAX_BYTES,
        ) +
        " Считаются название темы, текст вопроса и варианты в UTF-8; знаки вроде €, → и кавычек занимают больше места.",
    });

  return [...errors, ...explanationErrors(question)];
}

/** At most one error: the first answer whose explanation does not fit. */
function explanationErrors(question: TrainerBankQuestion): FieldError[] {
  const answers = possibleAnswers(question).map((picked) => {
    const explanation = trainerAnswerExplanation(question, picked);
    return {
      label: answerLabel(picked),
      length: trainerTextLength(explanation),
      bytes: trainerExplanationDataBytes({ explanation }),
    };
  });
  const long = answers.find(
    ({ length }) => length > TRAINER_EXPLANATION_MAX_CHARS,
  );
  if (long)
    return [
      {
        field: "explanation",
        reason:
          over(
            `Разбор для ответа «${long.label}»`,
            "знаков",
            long.length,
            TRAINER_EXPLANATION_MAX_CHARS,
          ) + " Считается разбор выбранных вариантов вместе с общим разбором.",
      },
    ];
  const heavy = answers.find(
    ({ bytes }) => bytes > TELEGRAM_WIDGET_DATA_MAX_BYTES,
  );
  return heavy
    ? [
        {
          field: "explanation",
          reason:
            over(
              `Данные разбора для виджета (ответ «${heavy.label}»)`,
              "байт",
              heavy.bytes,
              TELEGRAM_WIDGET_DATA_MAX_BYTES,
            ) +
            " Считается разбор выбранных вариантов вместе с общим разбором в UTF-8.",
        },
      ]
    : [];
}

/** Every answer the widget can send: one option or none, or any set for `multiple`. */
function possibleAnswers(question: TrainerBankQuestion): OptionMask[] {
  const count = question.options.length;
  return question.format === "single"
    ? [0, ...question.options.map((_, index) => 1 << index)]
    : Array.from({ length: 1 << count }, (_, mask) => mask);
}

function answerLabel(picked: OptionMask): string {
  const numbers: number[] = [];
  for (let index = 0; index < TRAINER_OPTIONS_MAX; index += 1)
    if ((picked & (1 << index)) !== 0) numbers.push(index + 1);
  if (numbers.length === 0) return "не знаю";
  return `${numbers.length === 1 ? "вариант" : "варианты"} ${numbers.join(", ")}`;
}
