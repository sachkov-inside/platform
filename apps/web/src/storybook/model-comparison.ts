import type { RenderedBlock } from "@inside/material-blocks";

export const modelComparisonBlocks: readonly RenderedBlock[] = [
  {
    kind: "heading",
    level: 2,
    content: [
      { kind: "text", text: "Какого агента и подписку выбрать", marks: [] },
    ],
  },
  ...[
    "Claude Opus 5.5 / Sonnet 5.5",
    "GPT-6.1 Sol / GPT-6.1 Terra / GPT-6 Luna",
    "DeepSeek V4.1 Flash",
    "GLM-5.3-Flash",
    "Kimi K3.1 Pro",
  ].map((title): RenderedBlock => ({
    kind: "callout",
    tone: "note",
    collapse: "expanded",
    title,
    content: [
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Цена.", marks: [{ kind: "bold" }] },
          {
            kind: "text",
            text: " Ссылка на тарифы",
            marks: [{ kind: "link", href: "https://example.com/pricing" }],
          },
        ],
      },
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Моё мнение.", marks: [{ kind: "bold" }] },
          {
            kind: "text",
            text: " Личного опыта пока нет. Длинный текст сравнения переносится по ширине экрана.",
            marks: [{ kind: "italic" }],
          },
          {
            kind: "text",
            text: " Подробнее об опыте",
            marks: [{ kind: "link", href: "https://example.com/opinion" }],
          },
        ],
      },
    ],
  })),
  {
    kind: "paragraph",
    content: [
      { kind: "text", text: "Продолжение урока после сравнения.", marks: [] },
    ],
  },
];
