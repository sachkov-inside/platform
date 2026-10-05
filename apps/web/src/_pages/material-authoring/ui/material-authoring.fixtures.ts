import { fn } from "storybook/test";

import {
  authoringMaterialPreviewHref,
  authoringMaterialsRootHref,
} from "@/shared/routing/authoring";
import type {
  MaterialAuthoringPresentation,
  MaterialPreviewBlock,
  MaterialPreviewPresentation,
  MaterialPreviewRoutePresentation,
  MaterialPreviewText,
} from "@/widgets/material-authoring";
import { fetchBeforeRender } from "@/storybook/mutation-mock";

/**
 * Данные редактора и предпросмотра материала для Storybook. Представления совпадают с тем, что
 * собирают серверные страницы маршрутов `/authoring/materials/*`: режим редактора, пустой
 * предпросмотр и чистое сохранение; остальное состояние страница получает из ответов BFF.
 */

/** Материал историй: его адрес стоит в маршруте редактора и предпросмотра. */
export const materialId = "94000000-0000-4000-8000-000000000203";

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
  {
    content: [paragraph(longFixtureText)],
    kind: "takeaways",
    title: longFixtureText,
  },
  {
    kind: "labeled_list",
    rows: [
      {
        description: longFixtureText,
        label: "Длинная метка",
        name: longFixtureText,
      },
    ],
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

/** Сохранённая версия материала: её показывает страница предпросмотра. */
export const materialPreview = {
  accessLabel: "Для участников",
  contentVersion: 7,
  materialId,
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
    {
      content: [text("Issue хранит intent, PR хранит evidence.")],
      kind: "key_point",
    },
    {
      kind: "variant",
      options: [
        {
          content: [
            paragraph(
              "Учебный проект: пройдите шаг на подготовленном репозитории.",
            ),
          ],
          mode: "example",
        },
        {
          content: [
            paragraph("Свой проект: примените шаг к своему репозиторию."),
          ],
          mode: "own",
        },
      ],
    },
    {
      content: [paragraph("Review закрыт"), paragraph("Owner дал merge GO")],
      kind: "takeaways",
      title: "Итоги урока",
    },
    {
      kind: "labeled_list",
      rows: [
        {
          description: "Фиксирует необратимый выбор",
          label: "ADR",
          name: "Решение",
        },
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
  summary:
    "Практический разбор delivery-потока: от готовой задачи до owner-controlled merge.",
  tags: ["developer pipeline", "agents", "delivery"],
  title: "Developer Pipeline без магии",
  topic: "AI для разработчиков",
  publicationState: "draft",
} as const satisfies MaterialPreviewPresentation;

export const materialAuthoringPresentation = {
  availableFormats: [
    { label: "Гайд", value: "guide" },
    { label: "Видео", value: "video" },
    { label: "Заметка", value: "note" },
  ],
  availableSeries: [
    {
      label: "Создание Platform Inside",
      value: "94000000-0000-4000-8000-000000000041",
    },
  ],
  availableTags: [
    { label: "delivery", value: "94000000-0000-4000-8000-000000000021" },
    { label: "agents", value: "94000000-0000-4000-8000-000000000022" },
    {
      label: "developer pipeline",
      value: "94000000-0000-4000-8000-000000000023",
    },
  ],
  availableTopics: [
    {
      label: "AI для разработчиков",
      value: "94000000-0000-4000-8000-000000000031",
    },
    {
      label: "Инженерный менеджмент",
      value: "94000000-0000-4000-8000-000000000032",
    },
    { label: "Архитектура", value: "94000000-0000-4000-8000-000000000033" },
    {
      label: "Developer experience",
      value: "94000000-0000-4000-8000-000000000034",
    },
  ],
  authorization: { kind: "allowed" },
  blocking: { kind: "none" },
  deletion: { pending: false, result: null },
  draft: {
    access: "membership",
    canDelete: true,
    deleteVideoId: null,
    detachVideoIds: [],
    difficulty: "intermediate",
    outcomes: [
      "Провести задачу от постановки до мержа",
      "Назвать шаг, на котором работа обычно застревает",
    ],
    latestVideoDeletion: null,
    unselectedVideoUpload: null,
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
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Issue хранит intent" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "PR хранит implementation evidence" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    formatId: "guide",
    materialId,
    contentVersion,
    readOnly: false,
    seriesIds: ["94000000-0000-4000-8000-000000000041"],
    status: "draft",
    summary:
      "Практический разбор delivery-потока: от готовой задачи до owner-controlled merge.",
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
  preview: null,
  save: { kind: "clean" },
  submissionId: "94000000-0000-4000-8000-000000000001",
  validation: { kind: "idle" },
} as const satisfies MaterialAuthoringPresentation;

/**
 * Урок с шагом для обоих режимов. Он живёт отдельной постановкой, потому что общий документ
 * редактора держит проверки вложения, и вставка шага сдвинула бы их.
 */
export const variantStepAuthoringPresentation = {
  ...materialAuthoringPresentation,
  draft: {
    ...materialAuthoringPresentation.draft,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Шаг написан для обоих способов пройти продукт.",
            },
          ],
        },
        {
          type: "variant",
          content: [
            {
              type: "variantOption",
              attrs: { mode: "example" },
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Учебный проект: пройдите шаг на подготовленном репозитории.",
                    },
                  ],
                },
              ],
            },
            {
              type: "variantOption",
              attrs: { mode: "own" },
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Свой проект: примените шаг к своему репозиторию.",
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: "paragraph" },
      ],
    },
    title: "Шаг для обоих режимов",
  },
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
    difficulty: "unassigned",
    document: { type: "doc", content: [{ type: "paragraph" }] },
    formatId: "unassigned",
    outcomes: [],
    materialId: null,
    contentVersion: null,
    status: "new",
    seriesIds: [],
    summary: "",
    tagIds: [],
    title: "",
    topicId: "unassigned",
  },
} as const satisfies MaterialAuthoringPresentation;

const previewRouteItem = (
  id: string,
  title: string,
  publicationState: "draft" | "published" | "unpublished",
  current = false,
) => ({
  current,
  href: authoringMaterialPreviewHref(
    `94000000-0000-4000-8000-0000000002${id}`,
    authoringMaterialsRootHref,
    "94000000-0000-4000-8000-000000000200",
  ),
  publicationState,
  title,
});
const previousRouteItem = previewRouteItem(
  "02",
  "Подготовка окружения и первый запуск агента",
  "draft",
);
const nextRouteItem = previewRouteItem("04", "Проверка результата", "draft");

/** Материал в середине закрытой главы: черновики стоят в маршруте наравне с опубликованным. */
export const materialPreviewRoute = {
  guideName: "Inside AI Engineering",
  kind: "ready",
  next: nextRouteItem,
  otherGuides: [],
  position: 3,
  previous: previousRouteItem,
  sections: [
    {
      chapterId: "94000000-0000-4000-8000-000000000210",
      items: [
        previewRouteItem("01", "Как устроен курс", "published"),
        previousRouteItem,
      ],
      name: "Глава 0. Старт",
    },
    {
      chapterId: "94000000-0000-4000-8000-000000000211",
      items: [
        previewRouteItem("03", "Developer Pipeline без магии", "draft", true),
        nextRouteItem,
      ],
      name: "Глава 1. Harness и первые уроки",
    },
    {
      chapterId: "94000000-0000-4000-8000-000000000212",
      items: [],
      name: "Глава 2. Контекст",
    },
    {
      chapterId: null,
      items: [previewRouteItem("05", "Словарь курса", "unpublished")],
      name: "Вне глав",
    },
  ],
  total: 5,
} as const satisfies MaterialPreviewRoutePresentation;

/** Ответ BFF материала: тело, сбой транспорта с кодом HTTP или запрос без ответа. */
export type MaterialReply =
  | Readonly<Record<string, unknown>>
  | { readonly httpStatus: number }
  | "pending";

/** Ответы по методу: создание, сохранение и удаление идут на один адрес BFF. */
export interface MaterialReplies {
  readonly DELETE?: MaterialReply | readonly MaterialReply[];
  readonly POST?: MaterialReply | readonly MaterialReply[];
  readonly PUT?: MaterialReply | readonly MaterialReply[];
}

/** Каждый запрос страницы к `/api/authoring/materials`: метод и отправленная форма. */
export const materialRequests = fn(
  (_method: string, _form: FormData | undefined): void => undefined,
);

export function savedReply(
  publicationState: "draft" | "published" | "unpublished" = "draft",
  contentVersion = 4,
) {
  return {
    contentVersion,
    kind: "saved",
    nextSubmissionId: "94000000-0000-4000-8000-000000000002",
    publicationState,
  } as const;
}

export const createdReply = {
  draft: { contentVersion: 1, materialId },
  kind: "created",
} as const;

/** Ответ на очередной запрос метода: последовательность повторяет свой последний ответ. */
function replyAt(
  configured: MaterialReply | readonly MaterialReply[] | undefined,
  index: number,
): MaterialReply | undefined {
  if (!isReplySequence(configured)) return configured;
  return configured[Math.min(index, configured.length - 1)];
}

function isReplySequence(
  value: MaterialReply | readonly MaterialReply[] | undefined,
): value is readonly MaterialReply[] {
  return Array.isArray(value);
}

function materialFetch(replies: MaterialReplies) {
  const served = new Map<string, number>();
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      window.location.origin,
    );
    const method = (init?.method ?? "GET").toUpperCase();
    if (
      url.pathname !== "/api/authoring/materials" ||
      (method !== "PUT" && method !== "POST" && method !== "DELETE")
    ) {
      return Promise.reject(
        new Error(`Story has no material reply for ${method} ${url.pathname}`),
      );
    }
    materialRequests(
      method,
      init?.body instanceof FormData ? init.body : undefined,
    );
    const configured = replies[method];
    const index = served.get(method) ?? 0;
    served.set(method, index + 1);
    const reply = replyAt(configured, index);
    if (reply === undefined || reply === "pending") {
      return new Promise<Response>(() => undefined);
    }
    if ("httpStatus" in reply && typeof reply.httpStatus === "number") {
      return Promise.resolve(new Response(null, { status: reply.httpStatus }));
    }
    return Promise.resolve(Response.json(reply));
  };
}

/** `beforeEach` истории: ставит ответы BFF материала до первого рендера страницы. */
export function materialBeforeRender(replies: MaterialReplies = {}) {
  return () => {
    materialRequests.mockClear();
    return fetchBeforeRender(materialFetch(replies))();
  };
}
