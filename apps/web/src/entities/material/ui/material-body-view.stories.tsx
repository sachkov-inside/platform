import { modelComparisonBlocks } from "@/storybook/model-comparison";
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

export const ModelComparison: Story = {
  args: {
    blocks: modelComparisonBlocks,
    comparison: { at: 1, labels: ["Claude", "GPT", "DeepSeek", "GLM", "Kimi"] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button")).toHaveLength(5);
    await expect(
      canvas.getByText("Продолжение урока после сравнения."),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Kimi" }));
    await expect(canvas.getByRole("region", { name: "Kimi K3" })).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Ссылка на тарифы" }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector('[data-material-block="callout"]'),
    ).toBeNull();
  },
};
export const ModelComparisonMobile: Story = {
  ...ModelComparison,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const ProseLinks: Story = {
  args: {
    blocks: [
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Перед началом работы прочитай ", marks: [] },
          {
            kind: "text",
            text: "Бриф заказчика",
            marks: [
              {
                kind: "link",
                href: "/materials/inside-content-aie-product-brief",
              },
            ],
          },
          {
            kind: "text",
            text: ". Вернись к нему, когда будешь уточнять требования.",
            marks: [],
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", {
      name: "Бриф заказчика",
    });
    await expect(link).toHaveAttribute(
      "href",
      "/materials/inside-content-aie-product-brief",
    );
    await expect(link).toHaveStyle({ textDecorationLine: "underline" });
    await userEvent.tab();
    await expect(link).toHaveFocus();
    await expect(getComputedStyle(link).outlineStyle).toBe("solid");
    await expect(
      parseFloat(getComputedStyle(link).outlineWidth),
    ).toBeGreaterThanOrEqual(2);
  },
};
export const ProseLinksDark: Story = {
  ...ProseLinks,
  decorators: [
    (Story) => (
      <div className="dark bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
};
