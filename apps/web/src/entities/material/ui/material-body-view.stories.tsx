import { modelComparisonBlocks } from "@/storybook/model-comparison";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { MaterialBodyView } from "./material-body-view";

const meta = {
  component: MaterialBodyView,
  id: "entities-material-body",
  title: "Components/Material/Body",
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
    await expect(
      canvas.getByRole("region", { name: "Kimi K3.1 Pro" }),
    ).toBeVisible();
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

/** A link whose text mixes words and inline code stays one link: one focus stop, one name. */
export const ProseLinkWithInlineCode: Story = {
  args: {
    blocks: [
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Начни с ", marks: [] },
          {
            kind: "text",
            text: "короткий ",
            marks: [{ kind: "link", href: "#pointers" }],
          },
          {
            kind: "text",
            text: "AGENTS.md",
            marks: [{ kind: "link", href: "#pointers" }, { kind: "code" }],
          },
          {
            kind: "text",
            text: " с указателями",
            marks: [{ kind: "link", href: "#pointers" }],
          },
          { kind: "text", text: ".", marks: [] },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const links = canvas.getAllByRole("link");
    await expect(links).toHaveLength(1);
    const link = canvas.getByRole("link", {
      name: "короткий AGENTS.md с указателями",
    });
    const code = link.querySelector("code");
    await expect(code).toHaveTextContent("AGENTS.md");
    // Side padding would let the chip background cover the link underline.
    await expect(code).toHaveStyle({ paddingLeft: "0px", paddingRight: "0px" });
    await userEvent.tab();
    await expect(link).toHaveFocus();
    await userEvent.tab();
    await expect(link).not.toHaveFocus();
  },
};

export const ExternalProseLinks: Story = {
  args: {
    blocks: [
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "Документация",
            marks: [{ kind: "link", href: "https://example.com/docs" }],
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", {
      name: "Документация",
    });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  },
};

export const SameOriginProseLinks: Story = {
  render: (args) => (
    <MaterialBodyView
      {...args}
      blocks={[
        {
          kind: "paragraph",
          content: [
            {
              kind: "text",
              text: "Раздел материала",
              marks: [
                {
                  kind: "link",
                  href: `${window.location.origin}/materials/current#section`,
                },
              ],
            },
          ],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", {
      name: "Раздел материала",
    });
    await expect(link).not.toHaveAttribute("target");
  },
};

export const SameOriginProtocolRelativeLinks: Story = {
  ...SameOriginProseLinks,
  render: (args) => (
    <MaterialBodyView
      {...args}
      blocks={[
        {
          kind: "paragraph",
          content: [
            {
              kind: "text",
              text: "Раздел материала",
              marks: [
                {
                  kind: "link",
                  href: `//${window.location.host}/materials/current#section`,
                },
              ],
            },
          ],
        },
      ]}
    />
  ),
};

const instructionExample = [
  "## Writing to the owner",
  "",
  "Apply these rules to explanations, reports, and questions. Project style governs content such as lessons, scripts, and posts, as well as code, commit messages, and documents for agents.",
].join("\n");

/** Блок кода во врезке занимает её тело до краёв: рамка не вкладывается в рамку. */
async function expectCodeFillsCallout(canvasElement: HTMLElement) {
  const callout = canvasElement.querySelector("[data-callout]");
  const block = canvasElement.querySelector(
    '[data-material-block="codeBlock"]',
  );
  if (callout === null || block === null)
    throw new Error("The story needs a code block inside a callout");
  const outer = callout.getBoundingClientRect();
  const inner = block.getBoundingClientRect();
  // Only the callout's 1 px border separates the two edges.
  await expect(inner.left - outer.left).toBeLessThanOrEqual(1);
  await expect(outer.right - inner.right).toBeLessThanOrEqual(1);
  await expect(outer.bottom - inner.bottom).toBeLessThanOrEqual(1);
}

export const CodeBlockCopy: Story = {
  args: {
    blocks: [
      {
        kind: "callout",
        tone: "tip",
        title: "Мой пример глобальной инструкции",
        collapse: "collapsed",
        content: [{ kind: "code_block", text: instructionExample }],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas
      .getByText("Мой пример глобальной инструкции")
      .closest("summary");
    if (summary === null)
      throw new Error("A collapsible callout needs a summary");
    await userEvent.click(summary);
    const button = canvas.getByRole("button", { name: "Скопировать код" });
    await expect(button).toBeVisible();
    const code = canvasElement.querySelector("pre");
    if (code === null) throw new Error("A code block needs a pre element");
    const buttonBox = button.getBoundingClientRect();
    const codeBox = code.getBoundingClientRect();
    await expect(buttonBox.left).toBeGreaterThanOrEqual(codeBox.right);
    // A long line wraps: the reader sees the whole text without a hidden horizontal scroll.
    await expect(code.scrollWidth).toBeLessThanOrEqual(code.clientWidth);
    await expectCodeFillsCallout(canvasElement);
    await expect(buttonBox.height).toBeGreaterThanOrEqual(36);
    // The visible control may be compact; its touch area stays at least 44 px.
    const touchArea = getComputedStyle(button, "::after");
    await expect(touchArea.position).toBe("absolute");
    await expect(parseFloat(touchArea.width)).toBeGreaterThanOrEqual(44);
    await expect(parseFloat(touchArea.height)).toBeGreaterThanOrEqual(44);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    try {
      await userEvent.click(button);
      await expect(copy).toHaveBeenCalledWith(instructionExample);
      await waitFor(() =>
        expect(canvas.getByRole("status")).toHaveTextContent("Код скопирован"),
      );
      await expect(button).toHaveAccessibleName("Скопировать код");
    } finally {
      copy.mockRestore();
    }
  },
};

export const CodeBlockCopyMobile: Story = {
  ...CodeBlockCopy,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const CodeBlockCopyDesktop: Story = {
  ...CodeBlockCopy,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
};

export const CodeBlockInPlainCallout: Story = {
  args: {
    blocks: [
      {
        kind: "callout",
        tone: "example",
        title: "Пример промпта",
        content: [{ kind: "code_block", text: instructionExample }],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Скопировать код" }),
    ).toBeVisible();
    await expectCodeFillsCallout(canvasElement);
  },
};
export const CodeBlockInPlainCalloutMobile: Story = {
  ...CodeBlockInPlainCallout,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const CodeBlockCopyFailure: Story = {
  args: { blocks: [{ kind: "code_block", text: "const result = 1;" }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const copy = spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    try {
      await userEvent.click(
        canvas.getByRole("button", { name: "Скопировать код" }),
      );
      await waitFor(() =>
        expect(canvas.getByRole("status")).toHaveTextContent(
          "Не удалось скопировать. Код выделен, скопируйте его вручную",
        ),
      );
      await waitFor(() =>
        expect(window.getSelection()?.toString()).toBe("const result = 1;"),
      );
    } finally {
      copy.mockRestore();
      window.getSelection()?.removeAllRanges();
    }
  },
};

export const CodeBlockCopyUnavailable: Story = {
  args: { blocks: [{ kind: "code_block", text: "const result = 1;" }] },
  beforeEach: () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    return () => {
      if (previous === undefined)
        Reflect.deleteProperty(navigator, "clipboard");
      else Object.defineProperty(navigator, "clipboard", previous);
      window.getSelection()?.removeAllRanges();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Скопировать код" }),
    );
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Не удалось скопировать. Код выделен, скопируйте его вручную",
      ),
    );
    await waitFor(() =>
      expect(window.getSelection()?.toString()).toBe("const result = 1;"),
    );
  },
};
