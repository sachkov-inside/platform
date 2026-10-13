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
    "GPT-6.1 Sol / GPT-6 Luna",
    "DeepSeek V4.1 Flash",
    "GLM-5.3-Flash",
    "Kimi K3",
  ].map((title): RenderedBlock => ({
    kind: "callout",
    tone: "note",
    collapse: "expanded",
    title,
    content: [
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "Где использовать.",
            marks: [{ kind: "bold" }],
          },
          {
            kind: "text",
            text: " Подключения и инструменты выбранной модели.",
            marks: [],
          },
        ],
      },
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
          {
            kind: "text",
            text: "Примерные лимиты.",
            marks: [{ kind: "bold" }],
          },
          {
            kind: "text",
            text: " Условия тарифа остаются в исходном материале.",
            marks: [],
          },
        ],
      },
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Моё мнение.", marks: [{ kind: "bold" }] },
          {
            kind: "text",
            text: " Длинный текст сравнения переносится по ширине экрана. Переключатель сохраняет все абзацы и ссылки каждой модели, а на телефоне показывает одну карточку вместо широкой таблицы.",
            marks: [],
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
