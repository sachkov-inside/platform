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
  availableFormats: [
    { label: "Гайд", value: "94000000-0000-4000-8000-000000000011" },
    { label: "Видео", value: "94000000-0000-4000-8000-000000000012" },
  ],
  availableTags: [
    { label: "delivery", value: "94000000-0000-4000-8000-000000000021" },
    { label: "agents", value: "94000000-0000-4000-8000-000000000022" },
    { label: "developer pipeline", value: "94000000-0000-4000-8000-000000000023" },
  ],
  availableTopics: [
    { label: "AI для разработчиков", value: "94000000-0000-4000-8000-000000000031" },
    { label: "Инженерный менеджмент", value: "94000000-0000-4000-8000-000000000032" },
    { label: "Архитектура", value: "94000000-0000-4000-8000-000000000033" },
    { label: "Developer experience", value: "94000000-0000-4000-8000-000000000034" },
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
    formatId: "94000000-0000-4000-8000-000000000011",
    materialId: "mat_developer_pipeline",
    contentVersion,
    readOnly: false,
    status: "draft",
    summary: "Практический разбор delivery-потока: от готовой задачи до owner-controlled merge.",
    tagIds: [
      "94000000-0000-4000-8000-000000000021",
      "94000000-0000-4000-8000-000000000022",
      "94000000-0000-4000-8000-000000000023",
    ],
    title: "Developer Pipeline без магии",
    topicId: "94000000-0000-4000-8000-000000000031",
  },
  mode: "editor",
  noticeRevision: 0,
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
  submissionId: "94000000-0000-4000-8000-000000000001",
  validation: { kind: "idle" },
} as const satisfies MaterialAuthoringPresentation;

export const savedAfterEditingPresentation = {
  ...materialAuthoringPresentation,
  draft: {
    ...materialAuthoringPresentation.draft,
    contentVersion: savedContentVersion,
    title: "Новая версия Developer Pipeline",
  },
  preview: {
    ...materialAuthoringPresentation.preview,
    contentVersion: savedContentVersion,
    title: "Новая версия Developer Pipeline",
  },
  save: { kind: "saved", savedAtLabel: "12:41" },
  validation: { headingCount: 1, kind: "valid", plainTextLength: 214 },
} as const satisfies MaterialAuthoringPresentation;

export const emptyMaterialAuthoringPresentation = {
  ...materialAuthoringPresentation,
  draft: {
    ...materialAuthoringPresentation.draft,
    access: "free",
    document: { type: "doc", content: [{ type: "paragraph" }] },
    formatId: "unassigned",
    materialId: null,
    contentVersion: null,
    status: "new",
    summary: "",
    tagIds: [],
    title: "",
    topicId: "unassigned",
  },
  preview: null,
} as const satisfies MaterialAuthoringPresentation;
