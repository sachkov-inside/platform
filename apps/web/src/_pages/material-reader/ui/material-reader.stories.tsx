import {
  variantDiagram,
  expectVariantDiagram,
} from "@/storybook/image-variants";
import type { ComponentProps, ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
} from "@/_pages/material-reader/model/material-reader-view";
import { calloutTones } from "@/entities/material";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { ProductModeHint, ProductModeSwitch } from "@/features/product-modes";
import {
  ReadingProgressProvider,
  SavedReadingAction,
} from "@/features/reading-progress";
import { ProductModeProvider, type ProductMode } from "@/shared/product-mode";
import {
  materialReaderHref,
  parseMaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import {
  productPurchaseHref,
  subscriptionHrefFrom,
} from "@/shared/routing/subscription-route";
import {
  MaterialReaderAccess,
  MaterialReaderLoading,
  MaterialReaderNotFound,
  MaterialReaderUnexpectedError,
  MaterialReaderUnavailable,
} from "./material-reader-states";
import { LearningPracticePrompts } from "./learning-practice-prompts";
import { MaterialReaderView } from "./material-reader-view";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  numberedListBlocks,
  expectNumberedLists,
} from "@/storybook/material-list-start";

const material = {
  materialId: "02000000-0000-4000-8000-000000000010",
  contentVersion: 7,
  access: "free",
  cover: {
    coverId: "02000000-0000-4000-8000-000000000011",
    renditions: [{ height: 540, width: 960 }],
  },
  format: { name: "Гайд", slug: "guide" },
  difficulty: "intermediate",
  outcomes: [
    "Собрать повторяемый skill из готового процесса",
    "Проверить его на одном реальном прогоне",
  ],
  publishedAt: "2026-08-25T05:00:00.000Z",
  seriesMemberships: [
    {
      ordinal: 5,
      series: { name: "Создание Platform Inside", slug: "platform-inside" },
    },
  ],
  slug: "agent-first-skills",
  summary:
    "Как превратить повторяемый инженерный процесс в короткую repository-owned инструкцию, которую человек и агент выполняют одинаково.",
  tags: [{ name: "agent skills" }, { name: "harness" }],
  title: "Публичные skills для agent-first setup",
  topic: { name: "AI-first engineering", slug: "ai-first-engineering" },
} as const satisfies MaterialReaderMetadata;

const body = [
  {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        text: "Хороший skill начинается с повторяемого решения и проверяемого результата.",
        marks: [{ kind: "bold" }],
      },
    ],
  },
  {
    kind: "heading",
    level: 2,
    content: [
      { kind: "text", text: "Сначала найдите устойчивый seam", marks: [] },
    ],
  },
  {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        text: "Запишите вход, observable result и границу ответственности.",
        marks: [],
      },
    ],
  },
  {
    kind: "bullet_list",
    items: [
      [
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "Один authority", marks: [] }],
        },
      ],
      [
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "Один workflow", marks: [] }],
        },
      ],
      [
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "Одна проверка", marks: [] }],
        },
      ],
    ],
  },
  {
    kind: "callout",
    tone: "warning",
    content: [
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "Skill дополняет project rules, но не отменяет их.",
            marks: [],
          },
        ],
      },
    ],
  },
  {
    kind: "code_block",
    text: "export const isReady = (evidence: readonly string[]) => evidence.length > 0",
  },
  {
    kind: "heading",
    level: 3,
    content: [
      {
        kind: "text",
        text: "Проверьте instruction на двух задачах",
        marks: [],
      },
    ],
  },
  {
    kind: "table",
    rows: [
      {
        cells: [
          {
            header: true,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Признак", marks: [] }],
              },
            ],
          },
          {
            header: true,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Evidence", marks: [] }],
              },
            ],
          },
        ],
      },
      {
        cells: [
          {
            header: false,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Trigger", marks: [] }],
              },
            ],
          },
          {
            header: false,
            content: [
              {
                kind: "paragraph",
                content: [
                  { kind: "text", text: "Две реальные задачи", marks: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: "image",
    assetId: "image-agent-path",
    alt: "Маршрут от project rules через skill к evidence",
    caption: "Один authority, один workflow, одна проверка",
    height: 900,
    variants: [
      { height: 450, width: 480 },
      { height: 900, width: 960 },
    ],
    width: 960,
  },
  {
    kind: "file",
    assetId: "skill-review-checklist",
    label: "Чек-лист проверки repository-owned skill",
  },
] as const satisfies readonly ReaderBlock[];

/** Урок из блоков: по одному блоку каждого вида в обычном состоянии. */
const lessonBody = [
  {
    kind: "key_point",
    content: [
      {
        kind: "text",
        text: "Issue хранит intent, pull request хранит evidence.",
        marks: [],
      },
    ],
  },
  ...calloutTones.map((tone) => ({
    kind: "callout" as const,
    tone,
    content: [
      {
        kind: "paragraph" as const,
        content: [
          {
            kind: "text" as const,
            text: `Врезка вида ${tone} в обычном состоянии.`,
            marks: [],
          },
        ],
      },
    ],
  })),
  {
    kind: "callout",
    tone: "definition",
    title: "Правило одного источника",
    content: [
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Один authority на каждый факт.", marks: [] },
        ],
      },
    ],
  },
  {
    kind: "resource_card",
    title: "Спецификация Platform",
    description: "Что обещает контракт доставки.",
    url: "https://example.com/spec",
  },
  {
    kind: "agent_prompt",
    title: "Промпт для разбора",
    text: "Разбери материал и предложи три правки.",
  },
  {
    kind: "takeaways",
    title: "Итоги урока",
    content: [
      {
        kind: "paragraph",
        content: [{ kind: "text", text: "Review закрыт", marks: [] }],
      },
      {
        kind: "paragraph",
        content: [{ kind: "text", text: "Owner дал merge GO", marks: [] }],
      },
    ],
  },
  {
    kind: "labeled_list",
    rows: [
      {
        label: "ADR",
        name: "Решение",
        description: "Фиксирует необратимый выбор",
      },
      { label: "Gate", name: "Проверка" },
    ],
  },
] as const satisfies readonly ReaderBlock[];

const longText =
  "Длинный текст без переносов проверяет перенос строк и горизонтальную прокрутку: " +
  "решение фиксируется один раз, а проверка повторяется на каждом изменении, поэтому " +
  "формулировка остаётся длинной и подробной даже на узком экране.";

/** Те же блоки с длинным содержимым: проверка переноса и ширины на телефоне. */
const longLessonBody = [
  {
    kind: "key_point",
    content: [{ kind: "text", text: longText, marks: [] }],
  },
  {
    kind: "callout",
    tone: "warning",
    title: longText,
    content: [
      {
        kind: "paragraph",
        content: [{ kind: "text", text: longText, marks: [] }],
      },
    ],
  },
  {
    kind: "resource_card",
    title: longText,
    description: longText,
    url: "https://example.com/очень/длинный/адрес/страницы/с/разделами",
  },
  {
    kind: "agent_prompt",
    title: longText,
    text: `${longText}\n${longText}`,
  },
  {
    kind: "takeaways",
    title: longText,
    content: [
      {
        kind: "paragraph",
        content: [{ kind: "text", text: longText, marks: [] }],
      },
    ],
  },
  {
    kind: "labeled_list",
    rows: [{ label: "Длинная метка", name: longText, description: longText }],
  },
] as const satisfies readonly ReaderBlock[];

/** Незаполненные блоки: автор вставил блок и ещё не написал содержимое. */
const emptyLessonBody = [
  { kind: "key_point", content: [] },
  { kind: "callout", tone: "note", content: [] },
  { kind: "resource_card", title: "", url: "" },
  { kind: "agent_prompt", text: "" },
  { kind: "takeaways", title: "", content: [] },
  { kind: "labeled_list", rows: [] },
] as const satisfies readonly ReaderBlock[];

/** Шаг руководства, написанный для обоих режимов, и шаг только для своего проекта. */
const productModeBody = [
  {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        marks: [],
        text: "Подготовьте репозиторий к первому прогону.",
      },
    ],
  },
  {
    kind: "variant",
    options: [
      {
        mode: "example",
        content: [
          {
            kind: "heading",
            level: 3,
            content: [{ kind: "text", marks: [], text: "Проверка на образце" }],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                marks: [],
                text: "Склонируйте учебный репозиторий и запустите проверку на нём.",
              },
            ],
          },
        ],
      },
      {
        mode: "own",
        content: [
          {
            kind: "heading",
            level: 3,
            content: [{ kind: "text", marks: [], text: "Проверка у себя" }],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                marks: [],
                text: "Возьмите свой репозиторий и выпишите, чем его проверка отличается.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: "variant",
    options: [
      {
        mode: "own",
        content: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                marks: [],
                text: "Согласуйте проверку с тем, кто отвечает за ваш репозиторий.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        marks: [],
        text: "Дальше шаги одинаковы для обоих способов.",
      },
    ],
  },
] as const satisfies readonly ReaderBlock[];

const productModeReturnTarget = parseMaterialReaderReturnTarget(
  "/products/platform-inside",
);

/** Ни одного задания у урока: так выглядит большинство уроков, блок практики не рисуется. */
const noPractices = { kind: "available", practices: [] } as const;
const learnerMcp = {
  url: "https://inside.example.test/mcp/learning",
  publicClientId: "o92nmcpzb2te8z4loi82d",
  setupUrl: "https://inside.example.test/practice-review-setup.txt",
};

/**
 * Действия под уроком, которые маршрут передаёт всегда: отметка о прочтении, закладка и проверка
 * практики. Гостю отметка и закладка предлагают войти; запросов они не делают.
 */
function readerActions(
  materialId: string,
  format: string,
): Pick<
  ComponentProps<typeof MaterialReaderView>,
  | "bookmarkAction"
  | "practiceActions"
  | "readingAction"
  | "topBookmarkAction"
  | "topReadingAction"
> {
  return {
    topReadingAction: (
      <SavedReadingAction compact format={format} materialId={materialId} />
    ),
    topBookmarkAction: <SavedBookmarkAction compact materialId={materialId} />,
    readingAction: (
      <SavedReadingAction
        format={format}
        key={materialId}
        materialId={materialId}
      />
    ),
    bookmarkAction: <SavedBookmarkAction materialId={materialId} />,
    practiceActions: (
      <LearningPracticePrompts connection={learnerMcp} result={noPractices} />
    ),
  };
}

/** Закрытый материал: маршрут показывает отметку без права её поставить. */
function accessReadingAction(): ReactNode {
  return (
    <SavedReadingAction
      canMark={false}
      format={material.format.slug}
      key={material.materialId}
      materialId={material.materialId}
    />
  );
}

function ProductModeReader({
  initialMode,
  withModes = true,
}: {
  readonly initialMode: ProductMode;
  readonly withModes?: boolean;
}) {
  return (
    <ProductModeProvider initialMode={initialMode}>
      <MaterialReaderView
        {...readerActions(material.materialId, material.format.slug)}
        body={productModeBody}
        material={{ ...material, title: "Подготовка к первому прогону" }}
        {...(withModes
          ? {
              // Подсказка встаёт у первого шага, написанного для активного способа.
              modeHint: { at: 1, node: <ProductModeHint /> },
              modeSwitch: <ProductModeSwitch signedIn={false} />,
            }
          : {})}
        primaryVideo={null}
        returnTarget={productModeReturnTarget}
        seriesContext={{
          currentPosition: 2,
          next: null,
          previous: null,
          series: {
            hasModeVariants: withModes,
            href: productModeReturnTarget.href,
            name: "Создание Platform Inside",
          },
          totalMaterials: 4,
        }}
      />
    </ProductModeProvider>
  );
}

const readyVideo = {
  durationSeconds: 754,
  state: "ready",
  title: "Разбор проверки skill contract",
  videoId: "03000000-0000-4000-8000-000000000001",
} as const;

const playlistReturnTarget = parseMaterialReaderReturnTarget(
  "/products/platform-inside",
);

const environment = publicPageEnvironment(`/materials/${material.slug}`);
const meta = {
  ...environment,
  component: MaterialReaderView,
  args: {
    ...readerActions(material.materialId, material.format.slug),
    body,
    material,
    primaryVideo: null,
  },
  decorators: [
    // Гость: оболочка приложения уже знает, что аккаунта нет, и отдаёт это прогрессу чтения.
    (Story) => (
      <ReadingProgressProvider accountId={null} resolved>
        <Story />
      </ReadingProgressProvider>
    ),
    ...environment.decorators,
  ],
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Production-owned Reader presentation. Stories exercise the exact UI used by the App Router route while fixtures stay outside the production graph.",
      },
    },
  },
  title: "Pages/Material Reader",
} satisfies Meta<typeof MaterialReaderView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OrderedListStart: Story = {
  args: { body: numberedListBlocks },
  play: async ({ canvasElement }) => expectNumberedLists(canvasElement),
};

export const OrderedListStartMobile: Story = {
  ...OrderedListStart,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Mobile: Story = {
  args: {},
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", {
        name: "Публичные skills для agent-first setup",
        level: 1,
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("navigation", { name: "Мобильная навигация" }),
    ).toBeVisible();
    await expect(canvas.getByLabelText("Содержание: 2")).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(
        '[data-content-cover-id="02000000-0000-4000-8000-000000000011"]',
      ),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("img", {
        name: "Маршрут от project rules через skill к evidence",
      }),
    ).toBeInTheDocument();
    const heading = canvas.getByRole("heading", {
      name: "Публичные skills для agent-first setup",
      level: 1,
    });
    const readerBody =
      canvasElement.querySelector<HTMLElement>("[data-reader-body]");
    if (readerBody === null) throw new Error("Reader structure is missing");
    await expect(getComputedStyle(heading).fontSize).toBe("24px");
    await expect(getComputedStyle(heading).overflowWrap).toBe("break-word");
    await expect(getComputedStyle(readerBody).color).toBe(
      getComputedStyle(heading).color,
    );
    await expect(
      getComputedStyle(
        canvas.getByRole("heading", {
          name: "Сначала найдите устойчивый seam",
          level: 2,
        }),
      ).fontSize,
    ).toBe("20px");
    await expect(
      canvas.queryByRole("list", { name: "Теги материала" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("list", { name: "Продукты материала" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("link", {
        name: /Чек-лист проверки repository-owned skill/u,
      }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByRole("article")).toHaveLength(1);
    const document = canvasElement.ownerDocument;
    const scrollRoot = document.scrollingElement;
    if (scrollRoot === null)
      throw new Error("Mobile document scroll is missing");
    await expect(
      canvasElement.querySelector("[data-public-header]"),
    ).not.toBeVisible();
    const back = canvas.getByRole("link", { name: "Назад на Главную" });
    await expect(
      canvasElement.querySelector('[data-reader-return="top"]')?.contains(back),
    ).toBe(true);
    const originalFontSize = document.documentElement.style.fontSize;
    try {
      for (const fontSize of ["100%", "200%"]) {
        document.documentElement.style.fontSize = fontSize;
        await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
          document.documentElement.clientWidth,
        );
      }
    } finally {
      document.documentElement.style.fontSize = originalFontSize;
      scrollRoot.scrollTop = 0;
    }
    await expect(
      canvasElement.querySelector('[data-reader-return="bottom"]'),
    ).toBeNull();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    scrollRoot.scrollTop = scrollRoot.scrollHeight;
    await waitFor(async () => {
      await expect(
        canvasElement.querySelector('[data-reader-return="bottom"]'),
      ).not.toBeNull();
    });
    await expect(back.getBoundingClientRect().bottom).toBeLessThan(0);
    scrollRoot.scrollTop = 0;
    await waitFor(async () => {
      await expect(
        canvasElement.querySelector('[data-reader-return="bottom"]'),
      ).toBeNull();
    });
  },
};

/** Replays an initial visible entry queued together with the first scroll-out entry. */
export const MobileBatchedIntersection: Story = {
  ...Mobile,
  name: "Mobile · batched intersections",
  beforeEach: () => {
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        let delivered = false;
        let pending: IntersectionObserverEntry[] = [];
        super((entries, observer) => {
          if (
            delivered ||
            !entries.some((entry) =>
              entry.target.hasAttribute("data-reader-return"),
            )
          ) {
            callback(entries, observer);
            return;
          }
          pending.push(...entries);
          if (!entries.some((entry) => !entry.isIntersecting)) return;
          delivered = true;
          callback(pending, observer);
          pending = [];
        }, options);
      }
    };
    return () => {
      window.IntersectionObserver = NativeObserver;
    };
  },
};

export const Desktop: Story = {
  args: { primaryVideo: readyVideo },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("navigation", { name: "В этом материале" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getAllByRole("link", { name: "Назад на Главную" }),
    ).toHaveLength(1);
    await expect(
      canvas.getByRole("region", { name: "Таблица в материале" }),
    ).toBeInTheDocument();
    const image = canvas.getByRole("img", {
      name: "Маршрут от project rules через skill к evidence",
    });
    if (!(image instanceof HTMLImageElement))
      throw new Error("Expected the material image");
    image.scrollIntoView({ behavior: "instant" });
    await image.decode();
    await expect(image.naturalWidth).toBeGreaterThan(0);
    await expect(image).toBeInTheDocument();
    canvasElement.ownerDocument.scrollingElement?.scrollTo(0, 0);
    for (const kind of ["table", "image", "file"] as const) {
      const block = canvasElement.querySelector<HTMLElement>(
        `[data-reader-block="${kind}"]`,
      );
      if (block === null) throw new Error(`Reader ${kind} block is missing`);
      await expect(
        Number.parseFloat(getComputedStyle(block).marginTop),
      ).toBeGreaterThanOrEqual(32);
    }
    await expect(
      canvas.queryByRole("button", { name: "Загрузить видео" }),
    ).not.toBeInTheDocument();
    // Отметку о прочтении маршрут ставит под уроком, поэтому у видео своей кнопки нет.
    await expect(
      canvas.queryByRole("button", { name: "Просмотрено" }),
    ).not.toBeInTheDocument();
    await expect(canvasElement.querySelector("iframe")).toBeNull();
    const title = canvas.getByRole("heading", {
      name: "Публичные skills для agent-first setup",
      level: 1,
    });
    const video = canvasElement.querySelector<HTMLElement>("[data-video-id]");
    const h2 = canvas.getByRole("heading", {
      name: "Сначала найдите устойчивый seam",
      level: 2,
    });
    const h3 = canvas.getByRole("heading", {
      name: "Проверьте instruction на двух задачах",
      level: 3,
    });
    if (video === null) throw new Error("Primary video is missing");
    await expect(getComputedStyle(title).fontSize).toBe("28px");
    await expect(
      Boolean(
        title.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    await expect(
      Number.parseFloat(getComputedStyle(h2).fontSize),
    ).toBeGreaterThan(Number.parseFloat(getComputedStyle(h3).fontSize));
    await expect(
      Number.parseFloat(getComputedStyle(h2).scrollMarginTop),
    ).toBeGreaterThanOrEqual(96);
  },
};

const readerImageAlt = "Маршрут от project rules через skill к evidence";

/** Картинка урока открывается на весь экран, приближается и возвращает фокус после закрытия. */
export const ImageViewer: Story = {
  args: { primaryVideo: readyVideo },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", {
      name: `Открыть изображение крупно: ${readerImageAlt}`,
    });
    await userEvent.click(trigger);
    const viewer = within(
      await canvas.findByRole("dialog", {
        name: `${readerImageAlt}, просмотр крупно`,
      }),
    );
    await expect(viewer.getByRole("button", { name: "Закрыть" })).toHaveFocus();
    await expect(
      viewer.getByText("Один authority, один workflow, одна проверка"),
    ).toBeVisible();
    await expect(
      viewer.getByRole("button", { name: "Отдалить" }),
    ).toBeDisabled();
    await userEvent.click(viewer.getByRole("button", { name: "Приблизить" }));
    await expect(viewer.getByText("150%")).toBeInTheDocument();
    await userEvent.keyboard("+");
    await expect(viewer.getByText("225%")).toBeInTheDocument();
    await userEvent.keyboard("0");
    await expect(viewer.getByText("100%")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(
      await canvas.findByRole("dialog", {
        name: `${readerImageAlt}, просмотр крупно`,
      }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  },
};

/** Если крупная картинка не загрузилась, окно предлагает загрузить её снова, а не тупик. */
export const ImageViewerFailed: Story = {
  args: { primaryVideo: readyVideo },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: `Открыть изображение крупно: ${readerImageAlt}`,
      }),
    );
    const dialog = await canvas.findByRole("dialog", {
      name: `${readerImageAlt}, просмотр крупно`,
    });
    const viewer = within(dialog);
    const failure = "Не удалось загрузить изображение.";
    // Окно рисует картинку после замера сцены. В тестовом запуске файл картинки может не прийти
    // вовсе; если он загрузился, ошибку вызывает сама история.
    const image = await waitFor(() => {
      const shown = viewer.queryByRole("img", { name: readerImageAlt });
      if (shown === null && viewer.queryByText(failure) === null)
        throw new Error("Картинка ещё не появилась.");
      return shown;
    });
    image?.dispatchEvent(new Event("error"));
    await expect(await viewer.findByText(failure)).toBeVisible();
    await expect(
      viewer.getByRole("button", { name: "Загрузить снова" }),
    ).toBeEnabled();
    await expect(viewer.getByRole("button", { name: "Закрыть" })).toBeVisible();
  },
};

/** Нажатие на фон окна без приближения закрывает просмотр. */
export const ImageViewerBackdropClose: Story = {
  args: { primaryVideo: readyVideo },
  globals: {
    viewport: { isRotated: false, value: "desktop1440" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: `Открыть изображение крупно: ${readerImageAlt}`,
      }),
    );
    const dialog = await canvas.findByRole("dialog", {
      name: `${readerImageAlt}, просмотр крупно`,
    });
    const stage = within(dialog).getByTestId("image-viewer-stage");
    const box = stage.getBoundingClientRect();
    await userEvent.pointer({
      keys: "[MouseLeft]",
      target: stage,
      coords: { clientX: box.left + 8, clientY: box.bottom - 8 },
    });
    await waitFor(() =>
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  },
};

/** На телефоне просмотр занимает весь экран; история оставляет его открытым и приближенным. */
export const ImageViewerMobile: Story = {
  args: { primaryVideo: readyVideo },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: `Открыть изображение крупно: ${readerImageAlt}`,
      }),
    );
    const dialog = await canvas.findByRole("dialog", {
      name: `${readerImageAlt}, просмотр крупно`,
    });
    const viewer = within(dialog);
    await userEvent.click(viewer.getByRole("button", { name: "Приблизить" }));
    await expect(viewer.getByText("150%")).toBeInTheDocument();
    const box = dialog.getBoundingClientRect();
    const page = canvasElement.ownerDocument.documentElement;
    await expect(box.width).toBe(page.clientWidth);
    await expect(box.height).toBe(window.innerHeight);
  },
};

export const VideoProcessing: Story = {
  args: {
    primaryVideo: {
      state: "processing",
      title: "Разбор проверки skill contract",
      videoId: "03000000-0000-4000-8000-000000000001",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Видео обрабатывается" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Можно продолжить чтение и вернуться к видео позже."),
    ).toBeVisible();
  },
};

export const VideoFailed: Story = {
  args: {
    primaryVideo: {
      failureCode: "provider_error",
      state: "failed",
      title: "Разбор проверки skill contract",
      videoId: "03000000-0000-4000-8000-000000000001",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Видео временно недоступно" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Хороший skill начинается", { exact: false }),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  render: () => <MaterialReaderLoading />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByLabelText("Материал загружается"),
    ).toHaveAttribute("aria-busy", "true");
  },
};

export const PlaylistReturn: Story = {
  args: {
    returnTarget: playlistReturnTarget,
    seriesContext: {
      currentPosition: 2,
      next: {
        href: materialReaderHref("review-video", playlistReturnTarget.href),
        title: "Видео-разбор проверки",
      },
      previous: {
        href: materialReaderHref("first-product", playlistReturnTarget.href),
        title: "Сначала границы",
      },
      series: {
        hasModeVariants: false,
        href: "/products/platform-inside/programme",
        name: "Создание Platform Inside",
      },
      totalMaterials: 3,
    },
  },
  play: async ({ canvasElement }) => {
    const seriesNavigation = within(canvasElement).getByRole("navigation", {
      name: "Навигация по продукту «Создание Platform Inside»",
    });
    await expect(
      within(seriesNavigation).getByRole("link", { name: "Открыть программу" }),
    ).toHaveAttribute("href", "/products/platform-inside/programme");
    const top = await within(canvasElement).findByRole("navigation", {
      name: "Действия материала",
    });
    await expect(
      within(top).getByRole("link", { name: "Дальше" }),
    ).toHaveAttribute(
      "href",
      "/materials/review-video?from=%2Fproducts%2Fplatform-inside",
    );
    await expect(
      within(top).getByRole("link", { name: "Назад" }),
    ).toHaveAttribute(
      "href",
      "/materials/first-product?from=%2Fproducts%2Fplatform-inside",
    );
    const readerBody =
      canvasElement.querySelector<HTMLElement>("[data-reader-body]");
    const readerFooter = canvasElement.querySelector<HTMLElement>(
      "[data-reader-footer]",
    );
    if (readerBody === null || readerFooter === null)
      throw new Error("Reader sequence is missing");
    await expect(
      Boolean(
        readerBody.compareDocumentPosition(seriesNavigation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    await expect(readerFooter.contains(seriesNavigation)).toBe(true);
    await expect(
      within(canvasElement).queryByRole("link", { name: "Назад к продукту" }),
    ).toBeNull();
    await expect(
      within(canvasElement).queryByText(/· №/u),
    ).not.toBeInTheDocument();
    await expect(
      within(seriesNavigation).getByRole("link", {
        name: "Дальше",
      }),
    ).toHaveAttribute(
      "href",
      "/materials/review-video?from=%2Fproducts%2Fplatform-inside",
    );
  },
};

export const NotFound: Story = {
  render: () => <MaterialReaderNotFound />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал не найден" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Назад на Главную" }),
    ).toBeInTheDocument();
  },
};

export const AccessRequired: Story = {
  render: () => (
    <MaterialReaderAccess
      invitation={{
        kind: "subscription",
        href: subscriptionHrefFrom(materialReaderHref(material.slug)),
      }}
      material={{ ...material, access: "closed" }}
      readingAction={accessReadingAction()}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Продолжение для участников" }),
    ).toBeInTheDocument();
    const membershipLink = canvas.getByRole("link", {
      name: "Получить доступ",
    });
    // Покупка начинается внутри платформы: внешнего адреса и новой вкладки здесь больше нет.
    await expect(membershipLink).toHaveAttribute(
      "href",
      "/payment/checkout?from=%2Fmaterials%2Fagent-first-skills",
    );
    await expect(membershipLink).not.toHaveAttribute("target");
    await expect(
      canvas.queryByRole("list", { name: "Теги материала" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("list", { name: "Продукты материала" }),
    ).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelector(
        '[data-content-cover-id="02000000-0000-4000-8000-000000000011"]',
      ),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("Хороший skill начинается"),
    ).not.toBeInTheDocument();
  },
};

/** Тот же отказ на телефоне: заголовок, объяснение и одно действие остаются читаемыми. */
export const AccessRequiredMobile: Story = {
  ...AccessRequired,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

/** Закрытый материал руководства со своей ценой: дальше идёт оплата именно этого руководства. */
export const AccessProductPurchase: Story = {
  render: () => (
    <MaterialReaderAccess
      invitation={{
        kind: "product",
        href: productPurchaseHref(material.seriesMemberships[0].series.slug),
      }}
      material={{ ...material, access: "closed" }}
      readingAction={accessReadingAction()}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Продолжение входит в продукт" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Купить продукт" }),
    ).toHaveAttribute("href", "/products/platform-inside/buy");
  },
};

/** Продажа выключена: обещания купить нет, материал честно остаётся на месте. */
export const AccessNotOffered: Story = {
  render: () => (
    <MaterialReaderAccess
      invitation={null}
      material={{ ...material, access: "closed" }}
      readingAction={accessReadingAction()}
    />
  ),
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(
        "Купить доступ сейчас нельзя, но материал останется здесь.",
      ),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("link", { name: "Получить доступ" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Купить продукт" }),
    ).not.toBeInTheDocument();
  },
};

export const Unavailable: Story = {
  render: () => <MaterialReaderUnavailable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал временно недоступен" }),
    ).toBeInTheDocument();
    // Повтор — кнопка, а не ссылка на тот же адрес: ссылку браузер обслужил бы из кеша маршрутов.
    await expect(
      canvas.getByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
  },
};

export const UnexpectedError: Story = {
  render: () => <MaterialReaderUnexpectedError onRetry={() => undefined} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал сейчас недоступен" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
  },
};

export const ShortMaterial: Story = {
  args: {
    body: [],
    material: {
      ...material,
      title: "Короткая заметка",
      summary: "Одна небольшая мысль.",
      difficulty: null,
      outcomes: [],
      tags: [],
      seriesMemberships: [],
    },
  },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Назад на Главную" }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector('[data-reader-return="bottom"]'),
    ).toBeNull();
    await expect(
      canvas.queryByRole("navigation", { name: "Действия материала" }),
    ).toBeNull();
    // Короткий материал умещается на экране целиком: ниже него идёт только общий футер сайта.
    const body = canvasElement.querySelector("[data-reader-body]");
    await expect(
      body?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
    ).toBeLessThanOrEqual(window.innerHeight);
  },
};

export const LessonBlocks: Story = {
  args: {
    body: lessonBody,
    material: { ...material, title: "Урок из готовых блоков" },
  },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const label of [
      "Примечание",
      "Совет",
      "Важно",
      "Пример",
      "Хорошо",
      "Плохо",
      "Определение",
      "Задание",
    ]) {
      await expect(
        canvas.getAllByLabelText(new RegExp(`^${label}`, "u")).length,
      ).toBeGreaterThan(0);
    }
    await expect(
      canvas.getByLabelText("Определение: Правило одного источника"),
    ).toBeInTheDocument();
    const resource = canvas.getByRole("link", { name: /Открыть/u });
    await expect(resource).toHaveAttribute("href", "https://example.com/spec");
    await expect(
      canvas.getByRole("button", { name: /Копировать/u }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("region", { name: "Итоги урока" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("Фиксирует необратимый выбор"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("Issue хранит intent, pull request хранит evidence."),
    ).toBeInTheDocument();
  },
};

export const LessonBlocksMobile: Story = {
  args: {
    body: lessonBody,
    material: { ...material, title: "Урок из готовых блоков" },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Итоги урока" }),
    ).toBeInTheDocument();
    const page = canvasElement.ownerDocument.documentElement;
    await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
  },
};

export const LessonBlocksLong: Story = {
  args: {
    body: longLessonBody,
    material: { ...material, title: "Урок с длинным содержимым" },
  },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: /Копировать/u }),
    ).toBeInTheDocument();
    const page = canvasElement.ownerDocument.documentElement;
    await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
  },
};

export const LessonBlocksEmpty: Story = {
  args: {
    body: emptyLessonBody,
    material: { ...material, title: "Урок с незаполненными блоками" },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Пустая карточка ресурса не предлагает открыть адрес, которого нет.
    await expect(
      canvas.queryByRole("link", { name: /Открыть/u }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Примечание")).toBeInTheDocument();
    await expect(
      canvas.getByRole("region", { name: "Итоги" }),
    ).toBeInTheDocument();
  },
};

export const ProductModes: Story = {
  render: () => <ProductModeReader initialMode="example" />,
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Подпись переключателя и есть его доступное имя: одно название, а не два.
    await expect(
      canvas.getByRole("group", { name: "Способ прохождения" }),
    ).toBeVisible();
    // Виден вариант активного режима; вариант чужого режима в разметке скрыт.
    await expect(
      canvas.getByText(/Склонируйте учебный репозиторий/u),
    ).toBeVisible();
    await expect(
      canvas.getByText(/Возьмите свой репозиторий/u),
    ).not.toBeVisible();
    // Односторонний шаг чужого режима не показывается совсем.
    await expect(
      canvas.queryByText(/Согласуйте проверку/u),
    ).not.toBeInTheDocument();
    // Подсказка о двух режимах показывается один раз и стоит у первого вариантного шага.
    await expect(
      canvas.getByText(/Переключить способ можно в шапке урока/u),
    ).toBeVisible();
    // Уровень сложности не показывается читателю; результаты урока остаются перед текстом.
    await expect(canvas.queryByText("Сложность: Средний")).toBeNull();
    await expect(
      canvas.getByRole("heading", { name: "Чему научишься" }),
    ).toBeVisible();
    // Ветка чужого режима скрыта и от вспомогательных технологий тоже.
    await expect(
      canvas.queryByRole("heading", { name: "Проверка у себя" }),
    ).not.toBeInTheDocument();
    // У заголовков разных веток разные якоря: иначе ссылка вела бы в скрытую ветку.
    const anchors = [
      ...canvasElement.querySelectorAll("[data-variant-branch] h3"),
    ].map((heading) => heading.id);
    await expect(anchors).toHaveLength(2);
    await expect(new Set(anchors).size).toBe(2);
    await expect(anchors.every(Boolean)).toBe(true);
    // Оглавление в вариантные шаги не заходит: набор заголовков не должен меняться от режима,
    // а ссылка в скрытую ветку никуда не ведёт. Других заголовков в уроке нет, поэтому его нет.
    await expect(
      canvasElement.querySelector('nav[aria-label="В этом материале"]'),
    ).toBeNull();
  },
};

export const ProductModesSwitched: Story = {
  render: () => <ProductModeReader initialMode="example" />,
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Свой проект" }));
    await waitFor(async () => {
      await expect(
        canvas.getByText(/Возьмите свой репозиторий/u),
      ).toBeVisible();
    });
    // Односторонний шаг появляется ровно в своём режиме.
    await expect(canvas.getByText(/Согласуйте проверку/u)).toBeVisible();
    await expect(
      canvas.getByText(/Склонируйте учебный репозиторий/u),
    ).not.toBeVisible();
  },
};

export const ProductModesOtherBranch: Story = {
  render: () => <ProductModeReader initialMode="example" />,
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Показать вариант «Свой проект»" }),
    );
    await waitFor(async () => {
      await expect(
        canvas.getByText(/Возьмите свой репозиторий/u),
      ).toBeVisible();
    });
    // Раскрытие второго варианта не меняет выбранный режим.
    await expect(
      canvas.getByRole("button", { name: "Учебный проект" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.getByText(/Склонируйте учебный репозиторий/u),
    ).toBeVisible();
  },
};

export const ProductModesMobile: Story = {
  render: () => <ProductModeReader initialMode="own" />,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Возьмите свой репозиторий/u)).toBeVisible();
    await expect(canvas.getByText(/Согласуйте проверку/u)).toBeVisible();
    const page = canvasElement.ownerDocument.documentElement;
    await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
  },
};

export const ProductWithoutModes: Story = {
  render: () => <ProductModeReader initialMode="example" withModes={false} />,
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // У руководства без вариантных шагов переключателя нет; шаги читаются в режиме по умолчанию.
    await expect(
      canvas.queryByRole("group", { name: "Способ прохождения" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(/Склонируйте учебный репозиторий/u),
    ).toBeVisible();
  },
};

export const SourceAnchors: Story = {
  args: {
    body: [
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "Перейти к разделу",
            marks: [{ kind: "link", href: "#как-спроектировать-один-этап" }],
          },
        ],
      },
      ...Array.from({ length: 20 }, () => ({
        kind: "paragraph" as const,
        content: [
          {
            kind: "text" as const,
            text: "Синтетический материал для проверки прокрутки к нужному заголовку.",
            marks: [],
          },
        ],
      })),
      {
        kind: "heading",
        level: 2,
        content: [
          {
            kind: "text",
            text: "Как спроектировать один этап?",
            marks: [{ kind: "bold" }],
          },
        ],
      },
      ...Array.from({ length: 20 }, () => ({
        kind: "paragraph" as const,
        content: [
          {
            kind: "text" as const,
            text: "Продолжение материала после целевого раздела.",
            marks: [],
          },
        ],
      })),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("heading", {
      name: "Как спроектировать один этап?",
    });
    await expect(heading).toHaveAttribute("id", "как-спроектировать-один-этап");
    const link = canvas.getByRole("link", { name: "Перейти к разделу" });
    // Vitest supplies a base URL; keep fragment navigation inside its tester iframe.
    link.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        window.location.hash = link.getAttribute("href") ?? "";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      },
      { once: true },
    );
    const previousUrl = window.location.href;
    try {
      await userEvent.click(link);
      await waitFor(async () => {
        const y = heading.getBoundingClientRect().top;
        await expect(y).toBeGreaterThanOrEqual(0);
        await expect(y).toBeLessThan(160);
      });
    } finally {
      window.history.replaceState(window.history.state, "", previousUrl);
    }
  },
};
export const SourceAnchorsMobile: Story = {
  ...SourceAnchors,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const SourceAnchorMetadataCollision: Story = {
  args: {
    body: [
      {
        kind: "heading",
        level: 2,
        content: [
          { kind: "text", text: "material-outcomes-heading", marks: [] },
        ],
      },
      {
        kind: "heading",
        level: 2,
        content: [
          {
            kind: "text",
            text: "material-outcomes-heading-metadata",
            marks: [],
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", {
        name: "material-outcomes-heading",
      }),
    ).toHaveAttribute("id", "material-outcomes-heading");
    const ids = Array.from(canvasElement.querySelectorAll("[id]")).map(
      (node) => node.id,
    );
    await expect(new Set(ids).size).toBe(ids.length);
    await expect(
      canvas.getByRole("region", { name: "Чему научишься" }),
    ).toBeInTheDocument();
  },
};

/** The owner chose the Content source address when a legacy alias conflicts. */
export const SourceAnchorLegacyCollision: Story = {
  args: {
    body: [
      {
        kind: "heading",
        level: 2,
        content: [{ kind: "text", text: "Первый раздел", marks: [] }],
      },
      ...(SourceAnchors.args?.body ?? []).slice(1).map((block) =>
        block.kind === "heading"
          ? {
              ...block,
              content: [
                {
                  kind: "text" as const,
                  text: "material-section-0",
                  marks: [],
                },
              ],
            }
          : block,
      ),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const target = canvas.getByRole("heading", { name: "material-section-0" });
    await expect(target).toHaveAttribute("id", "material-section-0");
    await expect(
      canvas.getByRole("heading", { name: "Первый раздел" }),
    ).toHaveAttribute("id", "первый-раздел");
    await expect(
      canvasElement.querySelectorAll('[id="material-section-0"]'),
    ).toHaveLength(1);
    const previousUrl = window.location.href;
    try {
      window.location.hash = "material-section-0";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await waitFor(async () => {
        const y = target.getBoundingClientRect().top;
        await expect(y).toBeGreaterThanOrEqual(0);
        await expect(y).toBeLessThan(160);
      });
    } finally {
      window.history.replaceState(window.history.state, "", previousUrl);
    }
  },
};

/** Shell IDs use punctuation that Content source slugs cannot produce. */
export const SourceAnchorShellCollision: Story = {
  args: {
    body: (SourceAnchors.args?.body ?? []).map((block, index) =>
      index === 0
        ? {
            kind: "paragraph" as const,
            content: [
              {
                kind: "text" as const,
                text: "Перейти к Content",
                marks: [{ kind: "link" as const, href: "#content" }],
              },
            ],
          }
        : block.kind === "heading"
          ? {
              ...block,
              content: [{ kind: "text" as const, text: "Content", marks: [] }],
            }
          : block,
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: /^Content$/u }),
    ).toHaveAttribute("id", "content");
    await expect(
      canvasElement.ownerDocument.querySelectorAll('[id="content"]'),
    ).toHaveLength(1);
    const main = canvasElement.ownerDocument.querySelector(
      "[data-application-content]",
    );
    await expect(main).toHaveAttribute("id", "app:content");
    await expect(
      canvas.getByRole("link", { name: /^Перейти к содержанию$/u }),
    ).toHaveAttribute("href", "#app:content");
  },
};

export const ImageVariants: Story = {
  args: { body: [variantDiagram], material: { ...material, cover: null } },
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => expectVariantDiagram(canvasElement, false),
};
export const ImageVariantsMobile: Story = {
  ...ImageVariants,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => expectVariantDiagram(canvasElement, true),
};

export const CollapsibleAdvice: Story = {
  args: {
    body: [
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
                text: "Ссылка в раскрытом совете",
                marks: [{ kind: "link", href: "https://example.com" }],
              },
            ],
          },
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
            content: [
              { kind: "text", text: "Совет открыт изначально", marks: [] },
            ],
          },
        ],
      },
      {
        kind: "callout",
        tone: "note",
        title: "Обычная врезка",
        content: [
          {
            kind: "paragraph",
            content: [
              { kind: "text", text: "Обычная врезка видна сразу", marks: [] },
            ],
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Ссылка в раскрытом совете"),
    ).not.toBeVisible();
    await expect(canvas.getByText("Совет открыт изначально")).toBeVisible();
    await expect(canvas.getByText("Обычная врезка видна сразу")).toBeVisible();
    const summary = canvas
      .getByText("Мой совет", { exact: true })
      .closest("summary");
    if (summary === null) throw new Error("Advice must have a summary");
    await userEvent.click(summary);
    await expect(
      canvas.getByRole("link", { name: "Ссылка в раскрытом совете" }),
    ).toBeVisible();
    await userEvent.click(summary);
    await expect(
      canvas.getByText("Ссылка в раскрытом совете"),
    ).not.toBeVisible();
  },
};
export const CollapsibleAdviceMobile: Story = {
  ...CollapsibleAdvice,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
