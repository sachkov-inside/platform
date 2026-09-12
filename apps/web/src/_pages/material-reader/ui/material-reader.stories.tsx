import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
} from "@/_pages/material-reader/model/material-reader-view";
import {
  materialReaderHref,
  parseMaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import {
  guidePurchaseHref,
  subscriptionHrefFrom,
} from "@/shared/routing/subscription-route";
import {
  MaterialReaderAccess,
  MaterialReaderLoading,
  MaterialReaderNotFound,
  MaterialReaderUnexpectedError,
  MaterialReaderUnavailable,
} from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";
import { publicPageEnvironment } from "@/workshop/story-environment";

const material = {
  materialId: "02000000-0000-4000-8000-000000000010",
  contentVersion: 7,
  access: "free",
  cover: {
    coverId: "02000000-0000-4000-8000-000000000011",
    renditions: [{ height: 540, width: 960 }],
  },
  format: { name: "Гайд", slug: "guide" },
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
    content: [{ kind: "text", text: "Сначала найдите устойчивый seam", marks: [] }],
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
    content: [{ kind: "text", text: "Проверьте instruction на двух задачах", marks: [] }],
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
                content: [{ kind: "text", text: "Две реальные задачи", marks: [] }],
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

type ReaderStoryMode =
  | "access-guide"
  | "access-not-offered"
  | "access-required"
  | "access-unavailable"
  | "desktop"
  | "error"
  | "loading"
  | "mobile"
  | "short"
  | "not-found"
  | "playlist-return"
  | "unavailable"
  | "video-failed"
  | "video-processing";

function MaterialReaderBoard({ mode }: { readonly mode: ReaderStoryMode }) {
  return <MaterialReaderState mode={mode} />;
}

function MaterialReaderState({ mode }: { readonly mode: ReaderStoryMode }) {
  switch (mode) {
    case "short":
      return <MaterialReaderView body={[]} material={{ ...material, title: "Короткая заметка", summary: "Одна небольшая мысль.", tags: [], seriesMemberships: [] }} primaryVideo={null} />;
    case "mobile":
      return <MaterialReaderView
        body={body}
        material={material}
        primaryVideo={null}
      />;
    case "desktop":
      return <MaterialReaderView
        body={body}
        material={material}
        primaryVideo={{
          durationSeconds: 754,
          state: "ready",
          title: "Разбор проверки skill contract",
          videoId: "03000000-0000-4000-8000-000000000001",
        }}
      />;
    case "playlist-return": {
      const returnTarget = parseMaterialReaderReturnTarget(
        "/series/platform-inside",
      );
      return (
        <MaterialReaderView
          body={body}
          material={material}
          primaryVideo={null}
          returnTarget={returnTarget}
          seriesContext={{
            currentPosition: 2,
            next: {
              href: materialReaderHref("review-video", returnTarget.href),
              title: "Видео-разбор проверки",
            },
            previous: {
              href: materialReaderHref("first-guide", returnTarget.href),
              title: "Сначала границы",
            },
            series: {
              href: returnTarget.href,
              name: "Создание Platform Inside",
            },
            totalMaterials: 3,
          }}
        />
      );
    }
    case "loading":
      return <MaterialReaderLoading />;
    case "video-processing":
      return <MaterialReaderView
        body={body}
        material={material}
        primaryVideo={{
          state: "processing",
          title: "Разбор проверки skill contract",
          videoId: "03000000-0000-4000-8000-000000000001",
        }}
      />;
    case "video-failed":
      return <MaterialReaderView
        body={body}
        material={material}
        primaryVideo={{
          failureCode: "provider_error",
          state: "failed",
          title: "Разбор проверки skill contract",
          videoId: "03000000-0000-4000-8000-000000000001",
        }}
      />;
    case "not-found":
      return <MaterialReaderNotFound />;
    case "access-required":
      return (
        <MaterialReaderAccess
          invitation={{
            kind: "subscription",
            href: subscriptionHrefFrom(materialReaderHref(material.slug)),
          }}
          material={{ ...material, access: "membership" }}
        />
      );
    case "access-guide":
      return (
        <MaterialReaderAccess
          invitation={{
            kind: "guide",
            href: guidePurchaseHref(material.seriesMemberships[0].series.slug),
          }}
          material={{ ...material, access: "membership" }}
        />
      );
    case "access-not-offered":
      return (
        <MaterialReaderAccess
          invitation={null}
          material={{ ...material, access: "membership" }}
        />
      );
    case "access-unavailable":
      return <MaterialReaderUnavailable retryHref={materialReaderHref(material.slug)} />;
    case "error":
      return <MaterialReaderUnexpectedError onRetry={() => undefined} />;
    case "unavailable":
      return <MaterialReaderUnavailable retryHref={materialReaderHref(material.slug)} />;
  }
}

const environment = publicPageEnvironment(`/materials/${material.slug}`);
const meta = {
  ...environment,
  component: MaterialReaderBoard,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Production-owned Reader presentation. Stories exercise the exact UI used by the App Router route while fixtures stay outside the production graph.",
      },
    },
  },
  title: "Pages/Mobile-first Platform/Reader",
} satisfies Meta<typeof MaterialReaderBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  args: { mode: "mobile" },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Публичные skills для agent-first setup", level: 1 }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("navigation", { name: "Мобильная навигация" })).toBeVisible();
    await expect(canvas.getByLabelText("Содержание: 2")).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(
        '[data-content-cover-id="02000000-0000-4000-8000-000000000011"]',
      ),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "Маршрут от project rules через skill к evidence" })).toBeInTheDocument();
    const heading = canvas.getByRole("heading", { name: "Публичные skills для agent-first setup", level: 1 });
    const readerBody = canvasElement.querySelector<HTMLElement>("[data-reader-body]");
    if (readerBody === null) throw new Error("Reader structure is missing");
    await expect(getComputedStyle(heading).fontSize).toBe("24px");
    await expect(getComputedStyle(heading).overflowWrap).toBe("break-word");
    await expect(getComputedStyle(readerBody).color).toBe(getComputedStyle(heading).color);
    await expect(
      getComputedStyle(
        canvas.getByRole("heading", { name: "Сначала найдите устойчивый seam", level: 2 }),
      ).fontSize,
    ).toBe("20px");
    await expect(canvas.queryByRole("list", { name: "Теги материала" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("list", { name: "Руководства материала" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /Чек-лист проверки repository-owned skill/u })).toBeInTheDocument();
    await expect(canvas.getAllByRole("article")).toHaveLength(1);
    const document = canvasElement.ownerDocument;
    const scrollRoot = document.scrollingElement;
    if (scrollRoot === null) throw new Error("Mobile document scroll is missing");
    await expect(canvasElement.querySelector("[data-public-header]")).not.toBeVisible();
    const back = canvas.getByRole("link", { name: "Назад в Базу знаний" });
    await expect(canvasElement.querySelector('[data-reader-return="top"]')?.contains(back)).toBe(true);
    const originalFontSize = document.documentElement.style.fontSize;
    try {
      for (const fontSize of ["100%", "200%"]) {
        document.documentElement.style.fontSize = fontSize;
        await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
      }
    } finally {
      document.documentElement.style.fontSize = originalFontSize;
      scrollRoot.scrollTop = 0;
    }
    await expect(canvasElement.querySelector('[data-reader-return="bottom"]')).toBeNull();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    scrollRoot.scrollTop = scrollRoot.scrollHeight;
    await waitFor(async () => {
      await expect(canvasElement.querySelector('[data-reader-return="bottom"]')).not.toBeNull();
    });
    await expect(back.getBoundingClientRect().bottom).toBeLessThan(0);
    scrollRoot.scrollTop = 0;
    await waitFor(async () => {
      await expect(canvasElement.querySelector('[data-reader-return="bottom"]')).toBeNull();
    });
  },
};

export const Desktop: Story = {
  args: { mode: "desktop" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("navigation", { name: "В этом материале" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("link", { name: "Назад в Базу знаний" })).toHaveLength(1);
    await expect(canvas.getByRole("region", { name: "Таблица в материале" })).toBeInTheDocument();
    const image = canvas.getByRole("img", { name: "Маршрут от project rules через skill к evidence" }) as HTMLImageElement;
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
      await expect(Number.parseFloat(getComputedStyle(block).marginTop)).toBeGreaterThanOrEqual(32);
    }
    await expect(canvas.queryByRole("button", { name: "Загрузить видео" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Просмотрено" })).toBeEnabled();
    await expect(canvasElement.querySelector("iframe")).toBeNull();
    const title = canvas.getByRole("heading", { name: "Публичные skills для agent-first setup", level: 1 });
    const video = canvasElement.querySelector<HTMLElement>("[data-video-id]");
    const h2 = canvas.getByRole("heading", { name: "Сначала найдите устойчивый seam", level: 2 });
    const h3 = canvas.getByRole("heading", { name: "Проверьте instruction на двух задачах", level: 3 });
    if (video === null) throw new Error("Primary video is missing");
    await expect(getComputedStyle(title).fontSize).toBe("28px");
    await expect(
      Boolean(title.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    await expect(Number.parseFloat(getComputedStyle(h2).fontSize)).toBeGreaterThan(
      Number.parseFloat(getComputedStyle(h3).fontSize),
    );
    await expect(Number.parseFloat(getComputedStyle(h2).scrollMarginTop)).toBeGreaterThanOrEqual(96);
  },
};

export const VideoProcessing: Story = {
  args: { mode: "video-processing" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Видео обрабатывается" })).toBeVisible();
    await expect(canvas.getByText("Можно продолжить чтение и вернуться к видео позже.")).toBeVisible();
  },
};

export const VideoFailed: Story = {
  args: { mode: "video-failed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Видео временно недоступно" })).toBeVisible();
    await expect(canvas.getByText("Хороший skill начинается", { exact: false })).toBeVisible();
  },
};

export const Loading: Story = {
  args: { mode: "loading" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("Материал загружается")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  },
};

export const PlaylistReturn: Story = {
  args: { mode: "playlist-return" },
  play: async ({ canvasElement }) => {
    const links = within(canvasElement).getAllByRole("link", {
      name: "Все материалы руководства",
    });
    await expect(links).toHaveLength(1);
    await expect(links[0]).toHaveAttribute("href", "/series/platform-inside");
    const seriesNavigation = within(canvasElement).getByRole("navigation", {
      name: "Навигация по руководству «Создание Platform Inside»",
    });
    const readerBody = canvasElement.querySelector<HTMLElement>("[data-reader-body]");
    const readerFooter = canvasElement.querySelector<HTMLElement>("[data-reader-footer]");
    if (readerBody === null || readerFooter === null) throw new Error("Reader sequence is missing");
    await expect(
      Boolean(readerBody.compareDocumentPosition(seriesNavigation) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    await expect(readerFooter.contains(seriesNavigation)).toBe(true);
    await expect(within(canvasElement).getByRole("link", { name: "Назад к руководству" })).toHaveAttribute("href", "/series/platform-inside");
    await expect(within(canvasElement).queryByText(/· №/u)).not.toBeInTheDocument();
    await expect(
      within(seriesNavigation).getByRole("link", {
        name: "Дальше",
      }),
    ).toHaveAttribute(
      "href",
      "/materials/review-video?from=%2Fseries%2Fplatform-inside",
    );
  },
};

export const NotFound: Story = {
  args: { mode: "not-found" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Материал не найден" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Назад в Базу знаний" })).toBeInTheDocument();
  },
};

export const AccessRequired: Story = {
  args: { mode: "access-required" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Продолжение для участников" }),
    ).toBeInTheDocument();
    const membershipLink = canvas.getByRole("link", { name: "Получить доступ" });
    // Покупка начинается внутри платформы: внешнего адреса и новой вкладки здесь больше нет.
    await expect(membershipLink).toHaveAttribute(
      "href",
      "/subscription?from=%2Fmaterials%2Fagent-first-skills",
    );
    await expect(membershipLink).not.toHaveAttribute("target");
    await expect(canvas.queryByRole("list", { name: "Теги материала" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("list", { name: "Руководства материала" })).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelector(
        '[data-content-cover-id="02000000-0000-4000-8000-000000000011"]',
      ),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText("Хороший skill начинается")).not.toBeInTheDocument();
  },
};

/** Тот же отказ на телефоне: заголовок, объяснение и одно действие остаются читаемыми. */
export const AccessRequiredMobile: Story = {
  ...AccessRequired,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

/** Закрытый материал руководства со своей ценой: дальше идёт оплата именно этого руководства. */
export const AccessGuidePurchase: Story = {
  args: { mode: "access-guide" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Продолжение входит в руководство" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Купить руководство" })).toHaveAttribute(
      "href",
      "/guides/platform-inside/buy",
    );
  },
};

/** Продажа выключена: обещания купить нет, материал честно остаётся на месте. */
export const AccessNotOffered: Story = {
  args: { mode: "access-not-offered" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Купить доступ сейчас нельзя, но материал останется здесь."),
    ).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Получить доступ" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Купить руководство" })).not.toBeInTheDocument();
  },
};

export const AccessUnavailable: Story = {
  args: { mode: "access-unavailable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал временно недоступен" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Повторить" })).toBeInTheDocument();
  },
};

export const Unavailable: Story = {
  args: { mode: "unavailable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал временно недоступен" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Повторить" })).toBeInTheDocument();
  },
};

export const UnexpectedError: Story = {
  args: { mode: "error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал сейчас недоступен" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  },
};

export const ShortMaterial: Story = {
  args: { mode: "short" },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Назад в Базу знаний" })).toBeVisible();
    await expect(canvasElement.querySelector('[data-reader-return="bottom"]')).toBeNull();
    await expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
  },
};
