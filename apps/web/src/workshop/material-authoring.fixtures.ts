import type {
  MaterialAuthoringPresentation,
  MaterialPreviewBlock,
  MaterialPreviewText,
} from "@/features/material-authoring";

const text = (value: string): MaterialPreviewText => ({
  kind: "text",
  marks: [],
  text: value,
});

const paragraph = (value: string): MaterialPreviewBlock => ({
  content: [text(value)],
  kind: "paragraph",
});

const contentVersion = 3;
export const savedContentVersion = 4;

export const materialAuthoringPresentation = {
  availableTopics: [
    { label: "AI для разработчиков", value: "ai-for-developers" },
    { label: "Инженерный менеджмент", value: "engineering-management" },
    { label: "Архитектура", value: "architecture" },
    { label: "Developer experience", value: "developer-experience" },
  ],
  authorization: { kind: "allowed" },
  blocking: { kind: "none" },
  draft: {
    access: "membership",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Developer Pipeline превращает issue в проверяемый результат и сохраняет owner gates видимыми на всём пути.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Сначала зафиксируйте outcome" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "У задачи должен быть один observable result, точный stopping condition и evidence, которое можно повторить.",
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Issue хранит intent" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "PR хранит implementation evidence" }] }],
            },
          ],
        },
      ],
    },
    format: "Guide",
    materialId: "mat_developer_pipeline",
    contentVersion,
    slug: "developer-pipeline-bez-magii",
    status: "draft",
    summary: "Практический разбор delivery-потока: от готовой задачи до owner-controlled merge.",
    tags: "developer pipeline, agents, delivery",
    title: "Developer Pipeline без магии",
    topic: "ai-for-developers",
  },
  mode: "editor",
  preview: {
    accessLabel: "Для участников",
    blocks: [
      paragraph(
        "Developer Pipeline превращает issue в проверяемый результат и сохраняет owner gates видимыми на всём пути.",
      ),
      {
        content: [text("Сначала зафиксируйте outcome")],
        kind: "heading",
        level: 2,
      },
      paragraph(
        "У задачи должен быть один observable result, точный stopping condition и evidence, которое можно повторить.",
      ),
      {
        items: [
          [paragraph("Issue хранит intent")],
          [paragraph("PR хранит implementation evidence")],
        ],
        kind: "bullet_list",
      },
      {
        content: [
          paragraph(
            "Preview показывает текущую версию содержимого и не меняет опубликованный Material.",
          ),
        ],
        kind: "callout",
        tone: "note",
      },
      {
        kind: "code_block",
        text: "issue -> branch -> evidence -> review -> owner GO",
      },
    ],
    contentVersion,
    format: "Guide",
    summary: "Практический разбор delivery-потока: от готовой задачи до owner-controlled merge.",
    tags: ["developer pipeline", "agents", "delivery"],
    title: "Developer Pipeline без магии",
    topic: "AI для разработчиков",
  },
  save: { kind: "clean" },
} as const satisfies MaterialAuthoringPresentation;

export const savedAfterEditingPresentation = {
  ...materialAuthoringPresentation,
  draft: {
    ...materialAuthoringPresentation.draft,
    contentVersion: savedContentVersion,
    title: "Новая версия Developer Pipeline",
    topic: "architecture",
  },
  preview: {
    ...materialAuthoringPresentation.preview,
    contentVersion: savedContentVersion,
    title: "Новая версия Developer Pipeline",
    topic: "Архитектура",
  },
  save: { kind: "saved", savedAtLabel: "12:41" },
} as const satisfies MaterialAuthoringPresentation;

export const emptyMaterialAuthoringPresentation = {
  ...materialAuthoringPresentation,
  draft: {
    ...materialAuthoringPresentation.draft,
    access: "free",
    document: { type: "doc", content: [{ type: "paragraph" }] },
    format: "Текст",
    materialId: null,
    contentVersion: null,
    slug: "",
    status: "new",
    summary: "",
    tags: "",
    title: "",
    topic: "",
  },
  preview: null,
} as const satisfies MaterialAuthoringPresentation;
