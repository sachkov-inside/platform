import { readerBlocksSchema } from "@inside/material-blocks";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type {
  ContentReaderBlock,
  RenderedBlock,
} from "@inside/material-blocks";
import { readerBlocks } from "@/storybook/quiz-content";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { MaterialReaderView } from "./material-reader-view";

/** Fixture adapter supplies prepared reading states; real conversion is tested at import seams. */
const prose = (markdown: string): RenderedBlock[] =>
  markdown.split("\n\n").map((text) =>
    text.startsWith("## ")
      ? {
          kind: "heading",
          level: 2,
          content: [{ kind: "text", text: text.slice(3), marks: [] }],
        }
      : { kind: "paragraph", content: [{ kind: "text", text, marks: [] }] },
  );
const renderFixture = (block: ContentReaderBlock): RenderedBlock[] => {
  if (block.kind === "markdown") return prose(block.markdown);
  if (block.kind === "step-break")
    return [{ kind: "step_break", label: block.label }];
  const common = {
    id: block.id,
    reveal: block.reveal,
    ...(block.contextMarkdown === undefined
      ? {}
      : { context: prose(block.contextMarkdown) }),
    question: prose(block.questionMarkdown),
    ...(block.dontKnow === undefined
      ? {}
      : {
          dontKnow: {
            explanation: prose(block.dontKnow.explanationMarkdown),
            reviewLinks: block.dontKnow.reviewLinks,
          },
        }),
  };
  switch (block.kind) {
    case "quiz":
      return [
        {
          kind: "quiz",
          ...common,
          selectionMode: block.selectionMode,
          options: block.options.map((option) => ({
            id: option.id,
            content: prose(option.markdown),
            correct: option.correct,
            ...(option.explanationMarkdown === undefined
              ? {}
              : { explanation: prose(option.explanationMarkdown) }),
          })),
        },
      ];
    case "match":
      return [
        {
          kind: "match",
          ...common,
          mode: block.mode,
          rows: block.rows.map((row) => ({
            id: row.id,
            content: prose(row.markdown),
            answerId: row.answerId,
            explanation: prose(row.explanationMarkdown),
          })),
          choices: block.choices.map((choice) => ({
            id: choice.id,
            content: prose(choice.markdown),
          })),
        },
      ];
    case "order":
      return [
        {
          kind: "order",
          ...common,
          steps: block.steps.map((step) => ({
            id: step.id,
            content: prose(step.markdown),
            explanation: prose(step.explanationMarkdown),
          })),
        },
      ];
  }
};
const body: RenderedBlock[] = readerBlocksSchema
  .parse(readerBlocks)
  .flatMap(renderFixture);
const meta = {
  ...publicPageEnvironment("/materials/quiz-proof"),
  id: "pages-material-reader-quiz",
  title: "Pages/Material Reader/Quiz",
  component: MaterialReaderView,
  args: {
    body,
    primaryVideo: null,
    material: {
      materialId: "02000000-0000-4000-8000-000000001283",
      contentVersion: 1,
      access: "free",
      cover: null,
      format: { name: "Гайд", slug: "guide" },
      difficulty: "basic",
      outcomes: [],
      publishedAt: "2026-10-09T09:00:00.000Z",
      productMemberships: [],
      slug: "quiz-proof",
      summary:
        "Учебная фикстура: как поставить агенту задачу и проверить результат.",
      tags: [],
      title: "Задача начинается с результата",
      topic: { name: "AI-first engineering", slug: "ai-first-engineering" },
    },
  },
} satisfies Meta<typeof MaterialReaderView>;
export default meta;
type Story = StoryObj<typeof meta>;

function quizOf(canvasElement: HTMLElement) {
  const root = canvasElement.querySelector<HTMLElement>("[data-material-quiz]");
  if (root === null) throw new Error("Quiz is missing");
  return within(root);
}

export const Unanswered: Story = {
  play: async ({ canvasElement }) => {
    const quiz = quizOf(canvasElement);
    await expect(
      quiz.getByRole("heading", { name: "Упражнение 1 из 3" }),
    ).toBeVisible();
    await expect(
      quiz.getByText("Агент добавил форму регистрации."),
    ).toBeVisible();
    await expect(quiz.queryByText(/Неверно\./u)).not.toBeInTheDocument();
    await expect(quiz.queryByText(/Верно\./u)).not.toBeInTheDocument();
    await expect(
      quiz.queryByRole("button", { name: "Ответить ещё раз" }),
    ).toBeNull();
  },
};
export const Correct: Story = {
  play: async ({ canvasElement }) => {
    const quiz = quizOf(canvasElement);
    await userEvent.click(
      quiz.getByRole("button", { name: /2\. После отправки/u }),
    );
    await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
    await expect(quiz.getByText(/Верно\. Критерий/u)).toBeVisible();
  },
};
export const Incorrect: Story = {
  play: async ({ canvasElement }) => {
    const quiz = quizOf(canvasElement);
    await userEvent.click(
      quiz.getByRole("button", { name: /1\. Форма написана/u }),
    );
    await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
  },
};
export const DontKnow: Story = {
  play: async ({ canvasElement }) => {
    const quiz = quizOf(canvasElement);
    await userEvent.click(quiz.getByRole("button", { name: "Не знаю" }));
    await expect(quiz.getByText("Правильный ответ:")).toBeVisible();
    await expect(
      quiz.getByRole("link", { name: "Повторить раздел" }),
    ).toHaveAttribute("href", "#проверяемый-результат");
  },
};
/** An answer stays until «Ответить ещё раз»; the next answer gets its own result. */
export const AnswerAgain: Story = {
  play: async ({ canvasElement }) => {
    const quiz = quizOf(canvasElement);
    const wrong = quiz.getByRole("button", { name: /1\. Форма написана/u });
    const correct = quiz.getByRole("button", { name: /2\. После отправки/u });
    await userEvent.click(wrong);
    const wrongOption = wrong.closest("[data-quiz-option]");
    if (wrongOption === null) throw new Error("Wrong option is missing");
    await expect(wrongOption).toHaveAttribute("data-result", "incorrect");
    const wrongColor = getComputedStyle(wrongOption).backgroundColor;
    await expect(correct).toBeDisabled();
    await expect(quiz.queryByRole("button", { name: "Не знаю" })).toBeNull();
    await userEvent.click(
      quiz.getByRole("button", { name: "Ответить ещё раз" }),
    );
    await expect(wrongOption).not.toHaveAttribute("data-result");
    await expect(quiz.queryByText("Пока неверно", { exact: true })).toBeNull();
    await userEvent.click(correct);
    const correctOption = correct.closest("[data-quiz-option]");
    if (correctOption === null) throw new Error("Correct option is missing");
    await expect(correctOption).toHaveAttribute("data-result", "correct");
    await expect(wrong).toHaveAttribute("aria-pressed", "false");
    await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
    await expect(getComputedStyle(correctOption).backgroundColor).not.toBe(
      wrongColor,
    );
    await expect(
      quiz.queryByRole("button", { name: "Все объяснения" }),
    ).toBeNull();
    await expect(quiz.queryByText("Ваш ответ:")).toBeNull();
  },
};
export const AnswerAgainMobile: Story = {
  ...AnswerAgain,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Exercises are numbered in lesson order; match and order show no explanations before an answer. */
export const ExerciseNumbering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Match and order stand after a step break: the lesson opens them by its button (#2122).
    await userEvent.click(
      canvas.getByRole("button", { name: "Как разделить работу?" }),
    );
    for (const name of [
      "Упражнение 1 из 3",
      "Упражнение 2 из 3",
      "Упражнение 3 из 3",
    ])
      await expect(canvas.getByRole("heading", { name })).toBeVisible();
    await expect(canvas.queryByText("План пишет планировщик.")).toBeNull();
    await expect(
      canvas.queryByText("Без результата нечего проверять."),
    ).toBeNull();
    const steps = canvasElement.querySelectorAll("[data-exercise-steps] li");
    await expect(steps).toHaveLength(3);
    await expect([...steps].map((step) => step.textContent)).not.toEqual([
      "Описать результат.",
      "Написать код.",
      "Проверить критерий.",
    ]);
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
  },
};
export const ExerciseNumberingMobile: Story = {
  ...ExerciseNumbering,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** In the lesson, a match lists the authored choices as text and an order explains every step. */
export const MatchAndOrderAnswered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Как разделить работу?" }),
    );
    const order = within(
      canvas.getByRole("region", { name: "Упражнение 3 из 3" }),
    );
    await userEvent.click(order.getByRole("button", { name: "Проверить" }));
    await expect(order.getByText(/Пока неверно: на месте/u)).toBeVisible();
    for (const explanation of [
      "Без результата нечего проверять.",
      "Код идёт после описания.",
      "Проверка завершает работу.",
    ])
      await expect(order.getByText(explanation)).toBeVisible();

    // Answered last, so its rows stay on screen: axe accepts a label only while it is visible.
    const match = within(
      canvas.getByRole("region", { name: "Упражнение 2 из 3" }),
    );
    for (const [row, choice] of [
      ["Пишет план изменений.", "Планировщик"],
      // Pairs are one to one, so the wrong answer swaps two choices.
      ["Меняет код.", "Проверяющий"],
      ["Проверяет результат.", "Исполнитель"],
    ] as const)
      await userEvent.selectOptions(
        match.getByRole("combobox", { name: row }),
        choice,
      );
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(match.getByText("Пока неверно: 1 из 3")).toBeVisible();
    await expect(match.getByText("Верный ответ: Проверяющий")).toBeVisible();
    await expect(match.getByText("Проверяет проверяющий.")).toBeVisible();
  },
};

export const RichOptionContent: Story = {
  args: {
    material: {
      ...meta.args.material,
      materialId: "02000000-0000-4000-8000-000000000010",
    },
    body: body.map((block) =>
      block.kind !== "quiz"
        ? block
        : {
            ...block,
            options: block.options.map((option, index) =>
              index !== 0
                ? option
                : {
                    ...option,
                    content: [
                      ...option.content,
                      {
                        kind: "callout",
                        collapse: "collapsed",
                        title: "Подсказка к варианту",
                        tone: "tip",
                        content: prose("Сначала проверьте результат."),
                      },
                      {
                        kind: "image",
                        assetId: "image-agent-path",
                        alt: "Схема проверки",
                        height: 900,
                        width: 960,
                        variants: [{ height: 900, width: 960 }],
                      },
                    ],
                  },
            ),
          },
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Подсказка к варианту"));
    await expect(
      canvas.getByText("Сначала проверьте результат."),
    ).toBeVisible();
    const image = await canvas.findByRole("button", {
      name: "Открыть изображение крупно: Схема проверки",
    });
    await userEvent.click(image);
    await expect(
      await canvas.findByRole("dialog", {
        name: "Схема проверки, просмотр крупно",
      }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    canvas
      .getByRole("img", { name: "Схема проверки" })
      .dispatchEvent(new Event("error"));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Загрузить снова" }),
    );
    await expect(
      await canvas.findByRole("button", {
        name: "Открыть изображение крупно: Схема проверки",
      }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: /1\. Форма написана/u }),
    );
    await expect(
      canvas.getByText("Пока неверно", { exact: true }),
    ).toBeVisible();
  },
};

/** Long choices wrap at phone width without inheriting the larger lesson heading. */
export const CompactLongChoicesMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  args: {
    ...RichOptionContent.args,
    body: body.map((block) =>
      block.kind !== "quiz"
        ? block
        : {
            ...block,
            options: block.options.map((option, index) =>
              index !== 0
                ? option
                : {
                    ...option,
                    content: prose(
                      "Форма написана, но результат ещё не проверен: агент должен подтвердить поведение приложения и назвать доказательства для каждого критерия задания.",
                    ),
                  },
            ),
          },
    ),
  },
  play: async ({ canvasElement }) => {
    const quiz = canvasElement.querySelector<HTMLElement>(
      "[data-material-quiz]",
    );
    if (quiz === null) throw new Error("Quiz is missing");
    const heading = within(quiz).getByRole("heading", {
      name: "Упражнение 1 из 3",
    });
    await expect(Number.parseFloat(getComputedStyle(heading).fontSize)).toBe(
      14,
    );
    for (const option of quiz.querySelectorAll<HTMLElement>(
      "[data-quiz-option]",
    )) {
      await expect(Number.parseFloat(getComputedStyle(option).fontSize)).toBe(
        14,
      );
      await expect(option.scrollWidth).toBeLessThanOrEqual(option.clientWidth);
      await expect(
        option.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(44);
    }
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
    await userEvent.click(
      within(quiz).getByRole("button", { name: /1\. Форма написана/u }),
    );
    await expect(
      within(quiz).getByText("Пока неверно", { exact: true }),
    ).toBeVisible();
  },
};

export const MultipleAnswerReader: Story = {
  args: {
    body: [
      ...prose("## Первая версия"),
      ...renderFixture({
        kind: "quiz",
        id: "mvp-features",
        reveal: "none",
        selectionMode: "multiple",
        questionMarkdown: "Какие возможности входят в первую версию платформы?",
        options: [
          [
            "accounts",
            "Приглашать сотрудников",
            "Сотрудники получают личные аккаунты.",
          ],
          [
            "projects",
            "Хранить проекты с репозиториями",
            "Доступ действует на весь проект.",
          ],
          [
            "github",
            "Интегрироваться с GitHub",
            "Начинаем интеграции с GitHub.",
          ],
          [
            "agent",
            "Подключать своего агента",
            "Агент использует доступ сотрудника.",
          ],
          [
            "cloud",
            "Запускать агентов в облаке",
            "Это направление дальнейшего развития.",
          ],
          [
            "budgets",
            "Управлять расходами на модели",
            "Бюджеты добавим позже.",
          ],
        ].map(([id = "", markdown = "", explanationMarkdown = ""], index) => ({
          id,
          markdown,
          correct: index < 4,
          explanationMarkdown,
        })),
        dontKnow: {
          explanationMarkdown:
            "Первая версия создаёт основу для дальнейшего развития.",
          reviewLinks: ["#первая-версия"],
        },
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const quiz = quizOf(canvasElement);
    await expect(
      quiz.getByRole("heading", { name: "Упражнение 1 из 1" }),
    ).toBeVisible();
    await expect(quiz.getAllByRole("checkbox")).toHaveLength(6);
    for (const checkbox of quiz.getAllByRole("checkbox").slice(0, 4))
      await userEvent.click(checkbox);
    await userEvent.click(quiz.getByRole("button", { name: "Проверить" }));
    await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
    await expect(quiz.getByText("Начинаем интеграции с GitHub.")).toBeVisible();
  },
};
