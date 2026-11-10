import { describe, expect, it } from "vitest";

import { readTrainerBankFile } from "../../src/modules/trainer/trainer-bank-file.js";
import {
  syntheticQuestion,
  syntheticTrainerBank,
  type SyntheticBank,
} from "../support/synthetic-trainer-bank.js";

function errorsOf(bank: unknown) {
  const result = readTrainerBankFile(bank);
  if (result.status !== "rejected") throw new Error("The file was accepted");
  return result.errors;
}

/** One topic with one question the case then spoils. */
function bankWith(
  change: (question: SyntheticBank["questions"][number]) => void,
): SyntheticBank {
  const bank = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
  const [question] = bank.questions;
  if (!question) throw new Error("The synthetic bank is empty");
  change(question);
  return bank;
}

describe("Bank file check", () => {
  it("accepts a synthetic bank with both question formats", () => {
    const result = readTrainerBankFile(
      syntheticTrainerBank({ topics: 2, questionsPerTopic: 3 }),
    );

    if (result.status !== "valid") throw new Error("The file was rejected");
    expect(result.bank.topics).toEqual([
      { code: "t1", name: "Синтетическая тема 1" },
      { code: "t2", name: "Синтетическая тема 2" },
    ]);
    expect(result.bank.questions).toHaveLength(6);
    expect(result.bank.questions[2]).toEqual({
      id: "q-t1-3",
      topic: "t1",
      format: "multiple",
      text: "Синтетический вопрос 3 темы t1",
      options: [
        { text: "Вариант А", correct: true, explanation: "Разбор А." },
        { text: "Вариант Б", correct: true, explanation: "Разбор Б." },
        { text: "Вариант В", correct: false, explanation: "Разбор В." },
        { text: "Вариант Г", correct: false, explanation: "Разбор Г." },
      ],
      explanation: "Общий разбор.",
      source: "Синтетический источник",
      checkedAt: "2026-10-01",
    });
  });

  it("rejects a file that is not a bank", () => {
    expect(errorsOf("not a bank")).toHaveLength(1);
    expect(errorsOf({ version: 2, topics: [], questions: [] })).not.toEqual([]);
  });

  it("names the question when a field breaks the schema", () => {
    const errors = errorsOf(
      bankWith((question) => {
        Reflect.deleteProperty(question, "source");
        question.checkedAt = "01.10.2026";
      }),
    );

    expect(errors.map(({ question, field }) => [question, field])).toEqual([
      ["q-t1-1", "source"],
      ["q-t1-1", "checkedAt"],
    ]);
  });

  it("rejects an unknown field so a typo does not pass silently", () => {
    const bank = bankWith(() => undefined);
    Object.assign(bank.questions[0] ?? {}, { explanaton: "Опечатка" });

    expect(errorsOf(bank)).toEqual([
      expect.objectContaining({ question: "q-t1-1" }),
    ]);
  });

  it.each([1, 5])("rejects a question with %i options", (count) => {
    const errors = errorsOf(
      bankWith((question) => {
        question.options = Array.from({ length: count }, (_, index) => ({
          text: `Вариант ${String(index + 1)}`,
          correct: index === 0,
          explanation: "Разбор.",
        }));
      }),
    );

    expect(errors).toEqual([
      expect.objectContaining({ question: "q-t1-1", field: "options" }),
    ]);
  });

  it("rejects a repeated question identifier and names it", () => {
    const bank = syntheticTrainerBank({ topics: 1, questionsPerTopic: 2 });
    bank.questions.push(syntheticQuestion("t1", 2));

    expect(errorsOf(bank)).toEqual([
      {
        question: "q-t1-2",
        field: "id",
        reason: "Идентификатор вопроса повторяется в файле.",
      },
    ]);
  });

  it("rejects a question of a topic the file does not list", () => {
    expect(
      errorsOf(
        bankWith((question) => {
          question.topic = "t9";
        }),
      ),
    ).toEqual([
      { topic: "t1", field: "code", reason: "У темы нет ни одного вопроса." },
      {
        question: "q-t1-1",
        field: "topic",
        reason: "Темы с кодом «t9» нет в списке тем файла.",
      },
    ]);
  });

  it.each([
    ["single", [true, true, false, false]],
    ["single", [false, false, false, false]],
    ["multiple", [true, false, false, false]],
    ["multiple", [false, false, false, false]],
  ] as const)(
    "rejects a %s question whose correct options are %j",
    (format, correct) => {
      const errors = errorsOf(
        bankWith((question) => {
          question.format = format;
          question.options.forEach((option, index) => {
            option.correct = correct[index] ?? false;
          });
        }),
      );

      expect(errors).toEqual([
        expect.objectContaining({ question: "q-t1-1", field: "options" }),
      ]);
    },
  );

  it("rejects a question text longer than the widget limit", () => {
    const fits = bankWith((question) => {
      question.text = "я".repeat(160);
    });
    const tooLong = bankWith((question) => {
      question.text = "я".repeat(161);
    });

    expect(readTrainerBankFile(fits).status).toBe("valid");
    expect(errorsOf(tooLong)).toEqual([
      {
        question: "q-t1-1",
        field: "text",
        reason: "Текст вопроса: знаков 161, лимит 160.",
      },
    ]);
  });

  it("rejects options that together are longer than the widget limit", () => {
    const fits = bankWith((question) => {
      question.options.forEach((option) => {
        option.text = "я".repeat(60);
      });
    });
    const tooLong = bankWith((question) => {
      question.options.forEach((option, index) => {
        option.text = "я".repeat(index === 0 ? 61 : 60);
      });
    });

    expect(readTrainerBankFile(fits).status).toBe("valid");
    expect(errorsOf(tooLong)).toEqual([
      {
        question: "q-t1-1",
        field: "options",
        reason: "Варианты вместе: знаков 241, лимит 240.",
      },
    ]);
  });

  it("rejects an explanation that is too long once the option's part joins the general part", () => {
    // The person sees the picked option's explanation, a space, then the general one.
    const fits = bankWith((question) => {
      question.options.forEach((option) => {
        option.explanation = "я".repeat(99);
      });
      question.explanation = "я".repeat(100);
    });
    const tooLong = bankWith((question) => {
      question.options.forEach((option, index) => {
        option.explanation = "я".repeat(index === 3 ? 100 : 99);
      });
      question.explanation = "я".repeat(100);
    });

    expect(readTrainerBankFile(fits).status).toBe("valid");
    expect(errorsOf(tooLong)).toEqual([
      {
        question: "q-t1-1",
        field: "explanation",
        reason:
          "Разбор для ответа «вариант 4»: знаков 201, лимит 200. Считается разбор выбранных вариантов вместе с общим разбором.",
      },
    ]);
  });

  it("counts every set of picked options for a question with several correct options", () => {
    const errors = errorsOf(
      bankWith((question) => {
        question.format = "multiple";
        question.options.forEach((option, index) => {
          option.correct = index < 2;
          option.explanation = "я".repeat(60);
        });
        question.explanation = "я".repeat(60);
      }),
    );

    // Three picked options: 3 × 60 + 60 + 3 spaces = 243 characters.
    expect(errors).toEqual([
      expect.objectContaining({ question: "q-t1-1", field: "explanation" }),
    ]);
    expect(errors[0]?.reason).toContain("«варианты 1, 2, 3»: знаков 243");
  });

  it("rejects question data over 1 024 bytes even inside the length limits", () => {
    // Three-byte signs: 160 + 240 characters take more than 1 024 bytes of UTF-8.
    const errors = errorsOf(
      bankWith((question) => {
        question.text = "€".repeat(160);
        question.options.forEach((option) => {
          option.text = "€".repeat(60);
        });
      }),
    );

    expect(errors).toEqual([
      expect.objectContaining({ question: "q-t1-1", field: "text" }),
    ]);
    expect(errors[0]?.reason).toMatch(
      /^Данные вопроса для виджета: байт \d+, лимит 1024\./,
    );
  });

  it("rejects explanation data over 1 024 bytes even inside the length limit", () => {
    // A control sign takes one character and six bytes of JSON.
    const errors = errorsOf(
      bankWith((question) => {
        question.options.forEach((option) => {
          option.explanation = "\u0007".repeat(99);
        });
        question.explanation = "\u0007".repeat(100);
      }),
    );

    expect(errors).toEqual([
      expect.objectContaining({ question: "q-t1-1", field: "explanation" }),
    ]);
    expect(errors[0]?.reason).toMatch(
      /^Данные разбора для виджета \(ответ «вариант 1»\): байт \d+, лимит 1024\./,
    );
  });

  it("rejects more topics than one screen shows, a repeated topic code and a long topic name", () => {
    const tooMany = syntheticTrainerBank({ topics: 10, questionsPerTopic: 1 });
    const repeated = syntheticTrainerBank({ topics: 2, questionsPerTopic: 1 });
    const [first, second] = repeated.topics;
    if (first && second) second.code = first.code;
    const longName = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
    if (longName.topics[0]) longName.topics[0].name = "я".repeat(41);

    expect(errorsOf(tooMany)).toEqual([
      { field: "topics", reason: "Тем в файле 10, лимит 9." },
    ]);
    expect(errorsOf(repeated)).toContainEqual({
      topic: "t1",
      field: "code",
      reason: "Код темы повторяется в файле.",
    });
    expect(errorsOf(longName)).toEqual([
      {
        topic: "t1",
        field: "name",
        reason: "Название темы: знаков 41, лимит 40.",
      },
    ]);
  });

  it("reports every broken question of the file at once", () => {
    const bank = syntheticTrainerBank({ topics: 1, questionsPerTopic: 3 });
    const [first, , third] = bank.questions;
    if (first) first.text = "я".repeat(161);
    if (third) third.topic = "t9";

    expect(errorsOf(bank).map(({ question }) => question)).toEqual([
      "q-t1-1",
      "q-t1-3",
    ]);
  });

  it("never repeats the texts of a question in the report", () => {
    const report = JSON.stringify(
      errorsOf(
        bankWith((question) => {
          question.text = "Секретный текст ".repeat(11);
          question.options.forEach((option) => {
            option.text = "Секретный вариант ".repeat(4);
          });
        }),
      ),
    );

    expect(report).not.toContain("Секретный");
  });
});
