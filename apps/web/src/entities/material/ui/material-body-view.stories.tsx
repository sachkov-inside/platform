import { modelComparisonBlocks } from "@/storybook/model-comparison";
import { courseGlossaryHref } from "@/shared/routing/subscription-route";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { highlightMaterialCode } from "../model/highlight-material-code";
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

/** How the browser writes a CSS colour once computed, so a token compares with a used value. */
function cssColor(canvasElement: HTMLElement, color: string): string {
  const probe = canvasElement.ownerDocument.createElement("span");
  probe.style.color = color;
  canvasElement.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}

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
    // The copy control sits above the code and never covers a line of it.
    await expect(buttonBox.bottom).toBeLessThanOrEqual(codeBox.top + 1);
    // Text without a language is often a prompt: a long line wraps instead of hiding past the edge.
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

const highlightedBlocks = [
  {
    kind: "code_block",
    language: "typescript",
    text: [
      "// Чанк хранит текст и вектор",
      'const chunks = documents.flatMap((document) => splitIntoChunks(document, { size: 512, overlap: 64, keepHeadings: true, source: document.path, language: document.language ?? "ru", embeddingModel: "text-embedding-3-small" }));',
    ].join("\n"),
  },
] as const;

/**
 * Код подсвечен по языку, подписан языком и не переносится: длинная строка прокручивается внутри
 * блока, а `=>` остаётся двумя знаками без лигатуры.
 */
export const CodeBlockHighlighted: Story = {
  args: { blocks: highlightedBlocks },
  loaders: [
    async () => ({
      codeHighlights: await highlightMaterialCode(highlightedBlocks),
    }),
  ],
  render: (args, { loaded }) => (
    <MaterialBodyView
      {...args}
      rendering={{
        ...args.rendering,
        codeHighlights: (
          loaded as {
            codeHighlights: Awaited<ReturnType<typeof highlightMaterialCode>>;
          }
        ).codeHighlights,
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const block = canvasElement.querySelector<HTMLElement>(
      '[data-material-block="codeBlock"]',
    );
    const pre = block?.querySelector("pre");
    if (block == null || pre == null)
      throw new Error("The story needs a code block");
    await expect(within(block).getByText("TypeScript")).toBeVisible();
    const keyword = within(pre).getByText("const");
    const comment = within(pre).getByText("// Чанк хранит текст и вектор");
    await expect(getComputedStyle(keyword).color).not.toBe(
      getComputedStyle(pre).color,
    );
    await expect(getComputedStyle(comment).color).not.toBe(
      getComputedStyle(keyword).color,
    );
    await expect(getComputedStyle(pre).whiteSpace).toBe("pre");
    await expect(getComputedStyle(pre).fontVariantLigatures).toBe("none");
    // The long line scrolls inside the block; the page itself never scrolls sideways.
    const scroller = block.querySelector<HTMLElement>("[data-code-scroll]");
    if (scroller === null) throw new Error("The code needs its own scroller");
    await expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};
export const CodeBlockHighlightedMobile: Story = {
  ...CodeBlockHighlighted,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const CodeBlockHighlightedDesktop: Story = {
  ...CodeBlockHighlighted,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
};

function tableCell(text: string, header = false) {
  return {
    header,
    content: [
      {
        kind: "paragraph" as const,
        content: [{ kind: "text" as const, text, marks: [] }],
      },
    ],
  };
}

const chunkTable = {
  kind: "table",
  rows: [
    {
      cells: ["Размер чанка", "Плюсы", "Минусы"].map((text) =>
        tableCell(text, true),
      ),
    },
    {
      cells: [
        tableCell("200 токенов"),
        tableCell("Точный поиск по узкому вопросу"),
        tableCell("Теряется контекст соседних абзацев"),
      ],
    },
  ],
} as const;

/**
 * Широкая таблица на узком экране прокручивается внутри себя, а край, за которым есть столбцы,
 * затенён: читатель видит, что таблица продолжается.
 */
export const WideTableMobile: Story = {
  args: { blocks: [chunkTable] },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const table = canvasElement.querySelector<HTMLElement>(
      '[data-reader-block="table"]',
    );
    if (table === null) throw new Error("The story needs a table");
    const scroller = table.querySelector<HTMLElement>("[data-table-scroll]");
    if (scroller === null) throw new Error("The table needs its scroller");
    await expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    await waitFor(() => expect(table).toHaveAttribute("data-overflow", "end"));
    const endFade = table.querySelector<HTMLElement>("[data-table-fade='end']");
    if (endFade === null) throw new Error("The table needs an end fade");
    await waitFor(() => expect(getComputedStyle(endFade).opacity).toBe("1"));
    scroller.scrollLeft = scroller.scrollWidth;
    await waitFor(() =>
      expect(table).toHaveAttribute("data-overflow", "start"),
    );
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};

/** На широком экране таблица помещается целиком, и края не затеняются. */
export const WideTableDesktop: Story = {
  args: { blocks: [chunkTable] },
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const table = canvasElement.querySelector<HTMLElement>(
      '[data-reader-block="table"]',
    );
    if (table === null) throw new Error("The story needs a table");
    await waitFor(() => expect(table).toHaveAttribute("data-overflow", "none"));
  },
};

/** Таблица в два столбца помещается и на узком экране, без прокрутки. */
export const NarrowTableMobile: Story = {
  args: {
    blocks: [
      {
        kind: "table",
        rows: [
          { cells: [tableCell("Термин", true), tableCell("Смысл", true)] },
          {
            cells: [
              tableCell("Чанк"),
              tableCell("Кусок документа, который ищет поиск"),
            ],
          },
        ],
      },
    ],
  },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const scroller = canvasElement.querySelector<HTMLElement>(
      "[data-table-scroll]",
    );
    if (scroller === null) throw new Error("The table needs its scroller");
    await expect(scroller.scrollWidth).toBeLessThanOrEqual(
      scroller.clientWidth,
    );
  },
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

const boundedContext = {
  id: "bounded-context",
  title: "Ограниченный контекст",
  englishTitle: "Bounded context",
  shortDefinition: "Граница, внутри которой у слов модели один смысл.",
  fullDefinition:
    "Часть системы со своей моделью и своим языком.\n\nСлово «заказ» внутри одной границы значит одно, в соседней другое.",
};

export const GlossaryTerms: Story = {
  args: {
    blocks: [
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Команда делит систему на ", marks: [] },
          {
            kind: "text",
            text: "ограниченные контексты",
            marks: [{ kind: "link", href: "term:bounded-context" }],
          },
          { kind: "text", text: ", а ", marks: [] },
          {
            kind: "text",
            text: "неизвестный термин",
            marks: [{ kind: "link", href: "term:unknown-term" }],
          },
          { kind: "text", text: " читается обычным текстом.", marks: [] },
        ],
      },
      { kind: "term_definition", termId: "bounded-context" },
      { kind: "term_definition", termId: "unknown-term" },
    ],
    rendering: {
      headingId: (path: readonly number[]) =>
        `material-section-${path.join("-")}`,
      image: () => null,
      file: () => null,
      glossary: new Map([[boundedContext.id, boundedContext]]),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    // An unknown term is neither a button nor a link, and its card is not shown.
    await expect(canvas.queryByRole("link")).toBeNull();
    await expect(
      canvas.getByText(/неизвестный термин/).closest("button"),
    ).toBeNull();
    await expect(
      canvasElement.querySelectorAll("[data-material-block=callout]"),
    ).toHaveLength(1);
    // The card shows the full definition from the Glossary.
    const card = canvas.getByRole("complementary", {
      name: "Определение: Ограниченный контекст (Bounded context)",
    });
    await expect(card).toHaveTextContent("Часть системы со своей моделью");
    // Variant A (#2118): an opaque sand surface from the lesson tokens, not a tinted mix.
    const sand = getComputedStyle(card)
      .getPropertyValue("--lesson-sand")
      .trim();
    await expect(getComputedStyle(card).backgroundColor).toBe(
      cssColor(canvasElement, sand),
    );

    const term = canvas.getByRole("button", { name: "ограниченные контексты" });
    await userEvent.click(term);
    await expect(term).toHaveAttribute("aria-expanded", "true");
    const bubble = await page.findByRole("dialog", {
      name: "Ограниченный контекст",
    });
    await expect(bubble).toHaveTextContent(boundedContext.shortDefinition);
    await expect(bubble).not.toHaveTextContent("Часть системы");
    await userEvent.click(
      within(bubble).getByRole("button", { name: "Подробнее" }),
    );
    await expect(bubble).toHaveTextContent("Часть системы со своей моделью");
    await expect(bubble).toHaveTextContent("в соседней другое");
    // The bubble stays inside the window with its 16 px gutter.
    const box = bubble.getBoundingClientRect();
    const viewport = canvasElement.ownerDocument.documentElement.clientWidth;
    await expect(box.left).toBeGreaterThanOrEqual(16);
    await expect(box.right).toBeLessThanOrEqual(viewport - 16);

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        page.queryByRole("dialog", { name: "Ограниченный контекст" }),
      ).toBeNull(),
    );
    await expect(term).toHaveFocus();
    await expect(term).toHaveAttribute("aria-expanded", "false");
  },
};
export const GlossaryTermsMobile: Story = {
  ...GlossaryTerms,
  globals: { viewport: { value: "mobile320", isRotated: false } },
};
/** Внутри курса «Подробнее» ведёт к термину на странице словаря курса (#2127). */
export const GlossaryTermInCourse: Story = {
  args: {
    blocks: [
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Команда делит систему на ", marks: [] },
          {
            kind: "text",
            text: "ограниченные контексты",
            marks: [{ kind: "link", href: "term:bounded-context" }],
          },
          { kind: "text", text: ".", marks: [] },
        ],
      },
    ],
    rendering: {
      headingId: (path: readonly number[]) =>
        `material-section-${path.join("-")}`,
      image: () => null,
      file: () => null,
      glossary: new Map([
        [
          boundedContext.id,
          {
            ...boundedContext,
            moreHref: courseGlossaryHref("ddd", "bounded-context"),
          },
        ],
      ]),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole("button", { name: "ограниченные контексты" }),
    );
    const bubble = await page.findByRole("dialog", {
      name: "Ограниченный контекст",
    });
    await expect(
      within(bubble).getByRole("link", { name: "Подробнее" }),
    ).toHaveAttribute("href", "/products/ddd/glossary#term-bounded-context");
    await expect(within(bubble).queryByRole("button")).toBeNull();
  },
};
function filler(index: number) {
  return {
    kind: "paragraph" as const,
    content: [
      {
        kind: "text" as const,
        text: `Абзац ${String(index + 1)} перед термином: над ним хватает места для подсказки.`,
        marks: [],
      },
    ],
  };
}

/**
 * Подсказка термина не закрывает строку, которую читают: когда сверху есть место, она открывается
 * над словом с зазором, и стрелка указывает на слово.
 */
export const GlossaryTermBubblePlacement: Story = {
  args: {
    ...GlossaryTerms.args,
    blocks: [
      ...Array.from({ length: 6 }, (_, index) => filler(index)),
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Команда делит систему на ", marks: [] },
          {
            kind: "text",
            text: "ограниченные контексты",
            marks: [{ kind: "link", href: "term:bounded-context" }],
          },
          {
            kind: "text",
            text: ", и каждая граница держит свой язык. Вторая строка этого предложения остаётся видна, пока читатель смотрит подсказку.",
            marks: [],
          },
        ],
      },
    ],
  },
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const term = canvas.getByRole("button", { name: "ограниченные контексты" });
    await userEvent.hover(term);
    const bubble = await page.findByRole("dialog", {
      name: "Ограниченный контекст",
    });
    await waitFor(() => expect(bubble).toHaveAttribute("data-side", "top"));
    const word = term.getBoundingClientRect();
    // A visible gap separates the bubble from the word's own line once it has its final height.
    await waitFor(() =>
      expect(
        word.top - bubble.getBoundingClientRect().bottom,
      ).toBeGreaterThanOrEqual(8),
    );
    const arrow = bubble.querySelector<HTMLElement>("[data-glossary-arrow]");
    if (arrow === null) throw new Error("The bubble needs an arrow");
    const tip = arrow.getBoundingClientRect();
    await expect(tip.left + tip.width / 2).toBeGreaterThanOrEqual(word.left);
    await expect(tip.left + tip.width / 2).toBeLessThanOrEqual(word.right);
  },
};
export const GlossaryTermBubblePlacementMobile: Story = {
  ...GlossaryTermBubblePlacement,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const term = canvas.getByRole("button", { name: "ограниченные контексты" });
    await userEvent.click(term);
    const bubble = await page.findByRole("dialog", {
      name: "Ограниченный контекст",
    });
    await waitFor(() => expect(bubble).toHaveAttribute("data-side"));
    const word = term.getBoundingClientRect();
    // Above or below, the bubble keeps a gap from the word and never covers it.
    await waitFor(() => {
      const placed = bubble.getBoundingClientRect();
      return expect(
        Math.max(word.top - placed.bottom, placed.top - word.bottom),
      ).toBeGreaterThanOrEqual(8);
    });
    const box = bubble.getBoundingClientRect();
    const root = canvasElement.ownerDocument.documentElement;
    await expect(box.left).toBeGreaterThanOrEqual(16);
    await expect(box.right).toBeLessThanOrEqual(root.clientWidth - 16);
  },
};

export const GlossaryTermsHover: Story = {
  ...GlossaryTerms,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const term = canvas.getByRole("button", { name: "ограниченные контексты" });
    await userEvent.hover(term);
    const bubble = await page.findByRole("dialog", {
      name: "Ограниченный контекст",
    });
    await expect(bubble).toHaveTextContent(boundedContext.shortDefinition);
    await userEvent.unhover(term);
    await waitFor(() =>
      expect(
        page.queryByRole("dialog", { name: "Ограниченный контекст" }),
      ).toBeNull(),
    );
  },
};
