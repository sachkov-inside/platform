import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { MaterialBodyView } from "./material-body-view";

const meta = {
  component: MaterialBodyView,
  title: "Entities/Material Body",
  args: {
    blocks: [
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "Текст с пояснением",
            marks: [{ kind: "bold" }],
          },
        ],
      },
      { kind: "code_block", text: "const result = 1;" },
    ],
    path: [],
    rendering: {
      headingId: (path: readonly number[]) =>
        `material-section-${path.join("-")}`,
      image: () => null,
      file: () => null,
    },
  },
} satisfies Meta<typeof MaterialBodyView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Document: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Текст с пояснением")).toBeVisible();
    await expect(canvas.getByText("const result = 1;")).toBeVisible();
  },
};

/** Contract proof only: current DOM preserves UUID/phrase; interactive card integration awaits #443 Storybook rendering. */
export const TermReferenceContract: Story = {
  args: {
    blocks: [
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "развёртывание",
            marks: [
              { kind: "bold" },
              { kind: "term", termId: "44300000-0000-4000-8000-000000000001" },
            ],
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const phrase = within(canvasElement).getByText("развёртывание");
    await expect(phrase.closest("[data-term-id]")).toHaveAttribute(
      "data-term-id",
      "44300000-0000-4000-8000-000000000001",
    );
  },
};

export const CollapsibleCallouts: Story = {
  args: {
    blocks: [
      {
        kind: "callout",
        tone: "tip",
        title: "Мой совет",
        collapse: "collapsed",
        content: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Ссылка внутри совета",
                marks: [{ kind: "link", href: "https://example.com" }],
              },
            ],
          },
          {
            kind: "callout",
            tone: "note",
            title: "Вложенный совет",
            collapse: "expanded",
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Вложенное тело", marks: [] }],
              },
            ],
          },
          { kind: "code_block", text: "> [!tip]- Литеральный пример" },
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Открытый совет",
        collapse: "expanded",
        content: [
          {
            kind: "paragraph",
            content: [{ kind: "text", text: "Открытое тело", marks: [] }],
          },
        ],
      },
      {
        kind: "callout",
        tone: "note",
        title: "Старая врезка",
        content: [
          {
            kind: "paragraph",
            content: [{ kind: "text", text: "Обычное тело", marks: [] }],
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas.getByText("Мой совет").closest("summary");
    if (summary === null)
      throw new Error("A collapsible callout needs a summary");
    await expect(canvas.getByText("Ссылка внутри совета")).not.toBeVisible();
    await expect(canvas.getByText("Открытое тело")).toBeVisible();
    await expect(canvas.getByText("Обычное тело")).toBeVisible();
    await userEvent.click(summary);
    await expect(
      canvas.getByRole("link", { name: "Ссылка внутри совета" }),
    ).toBeVisible();
    await expect(canvas.getByText("Вложенное тело")).toBeVisible();
    await expect(
      canvas.getByText("> [!tip]- Литеральный пример"),
    ).toBeVisible();
    await userEvent.click(summary);
    await expect(canvas.getByText("Ссылка внутри совета")).not.toBeVisible();
    await userEvent.click(summary);
    await expect(canvas.getByText("Ссылка внутри совета")).toBeVisible();
  },
};
export const CollapsibleCalloutsMobile: Story = {
  ...CollapsibleCallouts,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
