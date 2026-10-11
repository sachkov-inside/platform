import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { RenderedBlock } from "@inside/material-blocks";
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
const body: RenderedBlock[] = readerBlocks.flatMap((block): RenderedBlock[] =>
  block.kind === "markdown"
    ? prose(block.markdown)
    : [
        {
          kind: "quiz",
          id: block.id,
          prompt: prose(block.promptMarkdown),
          correctOptionId: block.correctOptionId,
          options: block.options.map((option) => ({
            id: option.id,
            content: prose(option.markdown),
            explanation: prose(option.explanationMarkdown),
          })),
          dontKnow: {
            explanation: prose(block.dontKnow.explanationMarkdown),
            reviewLinks: block.dontKnow.reviewLinks,
          },
        },
      ],
);
const meta = {
  ...publicPageEnvironment("/materials/quiz-proof"),
  title: "Pages/Material Reader Quiz",
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
      seriesMemberships: [],
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

export const Unanswered: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(
      canvasElement.querySelector("[data-material-quiz]") ?? canvasElement,
    );
    await expect(quiz.queryByText(/Неверно\./u)).not.toBeInTheDocument();
    await expect(quiz.queryByText(/Верно\./u)).not.toBeInTheDocument();
  },
};
export const Correct: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(
      canvasElement.querySelector("[data-material-quiz]") ?? canvasElement,
    );
    await userEvent.click(
      quiz.getByRole("button", { name: /2\. После отправки/u }),
    );
    await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
  },
};
export const Incorrect: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(
      canvasElement.querySelector("[data-material-quiz]") ?? canvasElement,
    );
    await userEvent.click(
      quiz.getByRole("button", { name: /1\. Форма написана/u }),
    );
    await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
  },
};
export const DontKnow: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(
      canvasElement.querySelector("[data-material-quiz]") ?? canvasElement,
    );
    await userEvent.click(quiz.getByRole("button", { name: "Не знаю" }));
    await expect(
      quiz.getByRole("link", { name: "Повторить раздел" }),
    ).toHaveAttribute("href", "#проверяемый-результат");
  },
};
export const SwitchAnswers: Story = {
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>(
      "[data-material-quiz]",
    );
    if (root === null) throw new Error("Quiz is missing");
    const quiz = within(root);
    const wrong = quiz.getByRole("button", { name: /1\. Форма написана/u });
    const correct = quiz.getByRole("button", { name: /2\. После отправки/u });
    await userEvent.click(wrong);
    await expect(wrong.closest("[data-quiz-option]")).toHaveAttribute(
      "data-result",
      "incorrect",
    );
    const wrongOption = wrong.closest("[data-quiz-option]");
    if (wrongOption === null) throw new Error("Wrong option is missing");
    const wrongColor = getComputedStyle(wrongOption).backgroundColor;
    await userEvent.click(correct);
    await expect(correct.closest("[data-quiz-option]")).toHaveAttribute(
      "data-result",
      "correct",
    );
    await expect(wrong).toHaveAttribute("aria-pressed", "false");
    await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
    const correctOption = correct.closest("[data-quiz-option]");
    if (correctOption === null) throw new Error("Correct option is missing");
    await expect(getComputedStyle(correctOption).backgroundColor).not.toBe(
      wrongColor,
    );
    await expect(
      quiz.queryByRole("button", { name: "Ответить ещё раз" }),
    ).toBeNull();
    await expect(
      quiz.queryByRole("button", { name: "Все объяснения" }),
    ).toBeNull();
    await expect(quiz.queryByText("Ваш ответ:")).toBeNull();
  },
};
export const SwitchAnswersMobile: Story = {
  ...SwitchAnswers,
  globals: { viewport: { value: "mobile390", isRotated: false } },
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
    await expect(canvas.queryByText("Состояние: Без ответа")).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: /1\. Форма написана/u }),
    );
    await expect(
      canvas.getByText("Пока неверно", { exact: true }),
    ).toBeVisible();
  },
};
