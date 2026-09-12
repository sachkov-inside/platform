import type {
  MaterialAuthoringPresentation,
  MaterialPreviewBlock,
  MaterialPreviewText,
} from "@/widgets/material-authoring";

const text = (value: string): MaterialPreviewText => ({
  kind: "text",
  marks: [],
  text: value,
});

const paragraph = (value: string): MaterialPreviewBlock => ({
  content: [text(value)],
  kind: "paragraph",
});

const longFixtureText =
  "Длинный текст без переносов проверяет перенос строк и горизонтальную прокрутку: " +
  "решение фиксируется один раз, а проверка повторяется на каждом изменении, поэтому " +
  "формулировка остаётся длинной и подробной даже на узком экране.";

/** Блоки урока с длинным содержимым: проверка переноса на самой узкой ширине. */
export const longLessonBlocks: readonly MaterialPreviewBlock[] = [
  { content: [text(longFixtureText)], kind: "key_point" },
  {
    content: [paragraph(longFixtureText)],
    kind: "callout",
    title: longFixtureText,
    tone: "warning",
  },
  {
    description: longFixtureText,
    kind: "resource_card",
    title: longFixtureText,
    url: "https://example.com/очень/длинный/адрес/страницы/с/разделами",
  },
  {
    kind: "agent_prompt",
    text: `${longFixtureText}\n${longFixtureText}`,
    title: longFixtureText,
  },
  { content: [paragraph(longFixtureText)], kind: "takeaways", title: longFixtureText },
  {
    kind: "labeled_list",
    rows: [{ description: longFixtureText, label: "Длинная метка", name: longFixtureText }],
  },
];

/** Незаполненные блоки урока: автор вставил блок и ещё не написал содержимое. */
export const emptyLessonBlocks: readonly MaterialPreviewBlock[] = [
  { content: [], kind: "key_point" },
  { content: [], kind: "callout", tone: "note" },
  { kind: "resource_card", title: "", url: "" },
  { kind: "agent_prompt", text: "" },
  { content: [], kind: "takeaways", title: "" },
  { kind: "labeled_list", rows: [] },
];

const contentVersion = 3;
export const savedContentVersion = 4;

export const materialAuthoringPresentation = {
  availableFormats: [
    { label: "Гайд", value: "guide" },
    { label: "Видео", value: "video" },
    { label: "Заметка", value: "note" },
  ],
  availableSeries: [
    { label: "Создание Platform Inside", value: "94000000-0000-4000-8000-000000000041" },
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
  deletion: { pending: false, result: null },
  draft: {
    access: "membership",
    canDelete: true,
    deleteVideoId: null,
    latestVideoDeletion: null,
    primaryVideo: null,
    primaryVideoId: null,
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
    formatId: "guide",
    materialId: "94000000-0000-4000-8000-000000000009",
    contentVersion,
    readOnly: false,
    seriesIds: ["94000000-0000-4000-8000-000000000041"],
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
    contentVersion: 7,
    materialId: "94000000-0000-4000-8000-000000000101",
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
        content: [paragraph("Один authority на каждый факт.")],
        kind: "callout",
        title: "Правило одного источника",
        tone: "definition",
      },
      { content: [text("Issue хранит intent, PR хранит evidence.")], kind: "key_point" },
      {
        content: [paragraph("Review закрыт"), paragraph("Owner дал merge GO")],
        kind: "takeaways",
        title: "Итоги урока",
      },
      {
        kind: "labeled_list",
        rows: [
          { description: "Фиксирует необратимый выбор", label: "ADR", name: "Решение" },
          { label: "Gate", name: "Проверка" },
        ],
      },
      {
        description: "Что обещает контракт доставки",
        kind: "resource_card",
        title: "Спецификация Platform",
        url: "https://example.com/spec",
      },
      {
        kind: "agent_prompt",
        text: "Разбери материал и предложи три правки.",
        title: "Промпт для разбора",
      },
      {
        kind: "code_block",
        text: "issue -> branch -> evidence -> review -> owner GO",
      },
      {
        kind: "table",
        rows: [
          {
            cells: [
              { content: [paragraph("Этап")], header: true },
              { content: [paragraph("Evidence")], header: true },
            ],
          },
          {
            cells: [
              { content: [paragraph("Review")], header: false },
              { content: [paragraph("Проверки зелёные")], header: false },
            ],
          },
        ],
      },
      {
        alt: "Схема Developer Pipeline",
        assetId: "94000000-0000-4000-8000-000000000051",
        caption: "Путь от issue до owner GO",
        height: 900,
        kind: "image",
        variants: [
          { height: 450, width: 480 },
          { height: 900, width: 960 },
        ],
        width: 960,
      },
      {
        assetId: "94000000-0000-4000-8000-000000000052",
        kind: "file",
        label: "Checklist проверки",
      },
    ],
    format: "Гайд",
    summary: "Практический разбор delivery-потока: от готовой задачи до owner-controlled merge.",
    tags: ["developer pipeline", "agents", "delivery"],
    title: "Developer Pipeline без магии",
    topic: "AI для разработчиков",
    publicationState: "draft",
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
    title: "Новая версия Developer Pipeline",
  },
  save: { kind: "saved", savedAtLabel: "12:41" },
  validation: { headingCount: 1, kind: "valid", plainTextLength: 214 },
} as const satisfies MaterialAuthoringPresentation;

/**
 * The same article with its image attachment in the editor. The catalog cannot deliver protected
 * bytes, so the block shows its saved-without-preview state; the form around it is the production
 * one. The asset is the image the preview already carries, so both sides describe one Material.
 */
export const imageAttachmentPresentation = {
  ...materialAuthoringPresentation,
  draft: {
    ...materialAuthoringPresentation.draft,
    document: {
      ...materialAuthoringPresentation.draft.document,
      content: [
        ...materialAuthoringPresentation.draft.document.content,
        {
          type: "assetImage",
          attrs: {
            alt: "",
            assetId: "94000000-0000-4000-8000-000000000051",
            caption: null,
          },
        },
        { type: "paragraph" },
      ],
    },
  },
} as const satisfies MaterialAuthoringPresentation;

export const emptyMaterialAuthoringPresentation = {
  ...materialAuthoringPresentation,
  draft: {
    ...materialAuthoringPresentation.draft,
    access: "free",
    canDelete: false,
    document: { type: "doc", content: [{ type: "paragraph" }] },
    formatId: "unassigned",
    materialId: null,
    contentVersion: null,
    status: "new",
    seriesIds: [],
    summary: "",
    tagIds: [],
    title: "",
    topicId: "unassigned",
  },
  preview: null,
} as const satisfies MaterialAuthoringPresentation;
