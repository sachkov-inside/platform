import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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
export const AllExplanations: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(
      canvasElement.querySelector("[data-material-quiz]") ?? canvasElement,
    );
    await userEvent.click(quiz.getByRole("button", { name: "Не знаю" }));
    await userEvent.click(quiz.getByRole("button", { name: "Все объяснения" }));
    await expect(
      quiz.getByRole("heading", { name: "Разбор всех вариантов" }),
    ).toBeVisible();
  },
};
