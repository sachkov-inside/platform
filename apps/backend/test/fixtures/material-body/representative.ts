import type { MaterialBodySnapshot } from "../../../src/modules/materials/index.js";

export function representativeDocument(text = "Issue хранит intent."): MaterialBodySnapshot {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: {
            level: 2,
            nodeId: "11111111-1111-4111-8111-111111111111",
          },
          content: [{ type: "text", text: "Developer Pipeline" }],
        },
        {
          type: "paragraph",
          attrs: { nodeId: "22222222-2222-4222-8222-222222222222" },
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

export function fullRepresentativeDocument(): MaterialBodySnapshot {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, nodeId: "01000000-0000-4000-8000-000000000001" },
          content: [{ type: "text", text: "Developer Pipeline" }],
        },
        {
          type: "paragraph",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000002" },
          content: [
            { type: "text", text: "Issue", marks: [{ type: "bold" }] },
            { type: "text", text: " хранит ", marks: [{ type: "italic" }] },
            { type: "text", text: "intent", marks: [{ type: "code" }] },
            { type: "text", text: " и ", marks: [{ type: "strike" }] },
            {
              type: "text",
              text: "evidence",
              marks: [{ type: "link", attrs: { href: "https://example.com/evidence" } }],
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "orderedList",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000018",
            start: 1,
          },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { nodeId: "01000000-0000-4000-8000-000000000019" },
                  content: [{ type: "text", text: "Decision" }],
                },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000003" },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { nodeId: "01000000-0000-4000-8000-000000000011" },
                  content: [{ type: "text", text: "Issue" }],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000004" },
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: "01000000-0000-4000-8000-000000000012" },
              content: [{ type: "text", text: "Owner gate." }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000005" },
          content: [{ type: "text", text: "pnpm check" }],
        },
        {
          type: "horizontalRule",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000020" },
        },
        {
          type: "table",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000006" },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: "01000000-0000-4000-8000-000000000013" },
                      content: [{ type: "text", text: "Stage" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: "01000000-0000-4000-8000-000000000014" },
                      content: [{ type: "text", text: "Evidence" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: "01000000-0000-4000-8000-000000000015" },
                      content: [{ type: "text", text: "Review" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { nodeId: "01000000-0000-4000-8000-000000000016" },
                      content: [{ type: "text", text: "Checks" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "callout",
          attrs: {
            kind: "warning",
            nodeId: "01000000-0000-4000-8000-000000000007",
          },
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: "01000000-0000-4000-8000-000000000017" },
              content: [{ type: "text", text: "Publish requires owner GO." }],
            },
          ],
        },
        {
          type: "callout",
          attrs: {
            kind: "example",
            nodeId: "01000000-0000-4000-8000-000000000021",
            title: "Пример",
          },
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: "01000000-0000-4000-8000-000000000022" },
              content: [{ type: "text", text: "Короткий разбор одного шага." }],
            },
          ],
        },
        {
          type: "resourceCard",
          attrs: {
            description: "Что обещает контракт",
            nodeId: "01000000-0000-4000-8000-000000000023",
            title: "Спецификация Platform",
            url: "https://example.com/spec",
          },
        },
        {
          type: "agentPrompt",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000024",
            title: "Промпт для разбора",
          },
          content: [
            { type: "text", text: "Разбери материал и предложи три правки." },
          ],
        },
        {
          type: "takeaways",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000025",
            title: "Итоги урока",
          },
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: "01000000-0000-4000-8000-000000000026" },
              content: [{ type: "text", text: "Один authority" }],
            },
            {
              type: "paragraph",
              attrs: { nodeId: "01000000-0000-4000-8000-000000000027" },
              content: [{ type: "text", text: "Одна проверка" }],
            },
          ],
        },
        {
          type: "labeledList",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000028",
            rows: [
              {
                description: "Фиксирует необратимый выбор",
                label: "ADR",
                name: "Решение",
              },
              { label: "Gate", name: "Проверка" },
            ],
          },
        },
        {
          type: "keyPoint",
          attrs: { nodeId: "01000000-0000-4000-8000-000000000029" },
          content: [
            { type: "text", text: "Вид блока задаёт платформа, а не вёрстка урока." },
          ],
        },
        {
          type: "assetImage",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000008",
            assetId: "02000000-0000-4000-8000-000000000001",
            alt: "Delivery stages",
            caption: "One retained path",
          },
        },
        {
          type: "assetFile",
          attrs: {
            nodeId: "01000000-0000-4000-8000-000000000009",
            assetId: "02000000-0000-4000-8000-000000000002",
            label: "Pipeline checklist",
          },
        },
      ],
    },
  };
}
