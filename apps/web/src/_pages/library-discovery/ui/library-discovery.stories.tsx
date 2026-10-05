import { Suspense, use } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { LibraryDiscoveryResult } from "@/features/library-discovery";
import type { MaterialPreview } from "@/entities/material";
import {
  LibraryDiscoveryLoading,
  LibraryDiscoveryNotFound,
  LibraryDiscoveryUnexpectedError,
  LibraryDiscoveryUnavailable,
  LibraryDiscoveryView,
} from "./library-discovery-view";
import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  stagedLoaders,
  stagedLoadingOf,
  type StagedLoading,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import { illustratedHome } from "@/storybook/home.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

const materials = [
  {
    access: "free",
    availability: "available",
    format: "Гайд",
    seriesMemberships: [
      { name: "Создание Platform Inside", ordinal: 1, slug: "platform-inside" },
    ],
    slug: "inside-platform-overview",
    summary: "Архитектура продукта, bounded contexts и delivery flow.",
    tags: ["Architecture", "Platform"],
    title: "Как устроен Inside Platform",
    topic: "Platform",
    topicSlug: "platform",
  },
  {
    access: "membership",
    availability: "locked",
    format: "Заметка",
    seriesMemberships: [
      { name: "Создание Platform Inside", ordinal: 2, slug: "platform-inside" },
    ],
    slug: "platform-membership",
    summary: "Закрытый выпуск о membership и доступе к материалам.",
    tags: ["Membership"],
    title: "Membership как часть Platform",
    topic: "Platform",
    topicSlug: "platform",
  },
] as const satisfies readonly MaterialPreview[];

const topicResult = {
  chapters: [],
  discoveryKind: "topic",
  hasNext: false,
  items: materials,
  kind: "ready",
  reference: {
    cover: {
      coverId: "02000000-0000-4000-8000-000000000061",
      renditions: [{ height: 540, width: 960 }],
    },
    name: "Platform",
    slug: "platform",
    summary: "Архитектура, продукт и поставка Platform.",
  },
  relatedSeries: [
    {
      id: "series-platform-inside",
      cover: {
        coverId: "02000000-0000-4000-8000-000000000062",
        renditions: [{ height: 540, width: 960 }],
      },
      matchingMaterialCount: 2,
      name: "Создание Platform Inside",
      slug: "platform-inside",
      summary: "Последовательный путь создания Platform.",
      totalMaterialCount: 2,
    },
  ],
  topics: [],
} as const satisfies LibraryDiscoveryResult;

const environment = publicPageEnvironment("/topics/platform");

const topicMaterials = [...illustratedHome.guides, ...illustratedHome.videos];
const formatNames: Record<string, string> = { guide: "Гайды", video: "Видео" };
/**
 * Ответ BFF `/api/library/topics/<slug>/materials`: список материалов темы приходит в браузере
 * после общей части страницы, как на маршруте.
 */
const topicCatalog = fetchBeforeRender((input) => {
  const url = new URL(
    String(input instanceof Request ? input.url : input),
    "http://story",
  );
  if (!url.pathname.startsWith("/api/library/topics/"))
    return Promise.resolve(new Response(null, { status: 404 }));
  const formats = [
    ...new Set(
      topicMaterials.flatMap((item) =>
        item.formatSlug === undefined ? [] : [item.formatSlug],
      ),
    ),
  ];
  return Promise.resolve(
    Response.json({
      kind: "ready",
      items: topicMaterials,
      facets: {
        formats: formats.map((slug) => ({
          count: topicMaterials.filter((item) => item.formatSlug === slug)
            .length,
          id: `format-${slug}`,
          name: formatNames[slug] ?? slug,
          slug,
          summary: null,
        })),
        series: [],
        topics: [],
      },
      nextCursor: null,
      totalCount: topicMaterials.length,
    }),
  );
});

const meta = {
  ...environment,
  // Каждая история темы получает свой список материалов из подменённого BFF, как на маршруте.
  beforeEach: () => {
    const restoreEnvironment = environment.beforeEach();
    const restoreFetch = topicCatalog();
    return () => {
      restoreFetch();
      restoreEnvironment?.();
    };
  },
  component: LibraryDiscoveryView,
  title: "Pages/Topic",
} satisfies Meta<typeof LibraryDiscoveryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TopicDesktop: Story = {
  args: { result: topicResult },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Topic · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Platform" }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector("[data-playlist-card]"),
    ).toHaveAttribute(
      "href",
      "/products/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252F",
    );
    for (const coverId of [
      "02000000-0000-4000-8000-000000000061",
      "02000000-0000-4000-8000-000000000062",
    ]) {
      await expect(
        canvasElement.querySelector(`[data-content-cover-id="${coverId}"]`),
      ).toBeInTheDocument();
    }
    await heroOpensAtTheSamePlace({ canvasElement });
    await expect(
      await canvas.findByRole("heading", { name: "Материалы" }),
    ).toBeVisible();
  },
};

export const TopicMobile: Story = {
  args: { result: topicResult },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Topic · mobile",
  play: heroOpensAtTheSamePlace,
};

export const TopicLongTitle: Story = {
  args: {
    result: {
      ...topicResult,
      reference: { ...topicResult.reference, name: "Т".repeat(120) },
    },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Topic · long title",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Unavailable: Story = {
  args: { result: topicResult },
  render: () => <LibraryDiscoveryUnavailable />,
  name: "Unavailable",
};

export const Loading: Story = {
  args: { result: topicResult },
  render: () => <LibraryDiscoveryLoading />,
  name: "Loading",
  play: heroOpensAtTheSamePlace,
};
export const LoadingMobile: Story = {
  ...Loading,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Loading · mobile",
};

/**
 * Первый экран подборки стоит на месте: оболочка одна и та же, ряд хлебных крошек занимает свою
 * высоту, а шапка начинается на свой отступ под ним. Скелет, который снова опишет оболочку сам,
 * теряет её имя и размер, и проверка это показывает.
 */
async function heroOpensAtTheSamePlace({
  canvasElement,
}: {
  canvasElement: HTMLElement;
}) {
  const frame = canvasElement.querySelector("[data-discovery-frame]");
  if (frame === null) throw new Error("Каркас подборки не отрисован");
  await expect(getComputedStyle(frame).containerName).toBe("discovery");
  // Прежний скелет обрезал себя до max-w-[58rem]: ширина и была поломкой, не только имя контейнера.
  await expect(getComputedStyle(frame).maxWidth).toBe("none");
  const [breadcrumb, hero] = frame.children;
  if (breadcrumb === undefined || hero === undefined)
    throw new Error("Первый экран подборки неполон");
  const breadcrumbBox = breadcrumb.getBoundingClientRect();
  await expect(
    Math.round(breadcrumbBox.top - frame.getBoundingClientRect().top),
  ).toBe(28);
  await expect(Math.round(breadcrumbBox.height)).toBe(40);
  await expect(
    Math.round(hero.getBoundingClientRect().top - breadcrumbBox.bottom),
  ).toBe(20);
}

/** Тема целиком общая (ADR 0027): под скелетом маршрута сразу готовая страница. */
function StagedTopic({ sequence }: { readonly sequence: StagedLoading }) {
  return (
    <Suspense fallback={<LibraryDiscoveryLoading />}>
      <TopicPage sequence={sequence} />
    </Suspense>
  );
}

function TopicPage({ sequence }: { readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return <LibraryDiscoveryView result={topicResult} />;
}

/** Ряд возврата и начало шапки темы: высота шапки зависит от названия и описания. */
const topicFrameOf = (canvasElement: HTMLElement) => ({
  breadcrumb: boxOf(canvasElement, "[data-discovery-frame] > :nth-child(1)"),
  hero: originOf(
    boxOf(canvasElement, "[data-discovery-frame] > :nth-child(2)"),
  ),
});

function topicLoadsInPlace({
  globals,
  width,
}: StoryViewport): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <StagedTopic sequence={stagedLoadingOf(loaded)} />
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const canvas = within(canvasElement);
      await expect(
        await canvas.findByLabelText("Подборка загружается"),
      ).toHaveAttribute("aria-busy", "true");
      const skeleton = topicFrameOf(canvasElement);

      stagedLoadingOf(loaded).deliverSharedPart();
      await canvas.findByRole("heading", { level: 1, name: "Platform" });

      await expect(skeleton).toEqual(topicFrameOf(canvasElement));
    },
  };
}

export const TopicLoadsInPlace: Story = {
  args: { result: topicResult },
  ...topicLoadsInPlace(desktop),
};
export const TopicLoadsInPlaceMobile: Story = {
  args: { result: topicResult },
  ...topicLoadsInPlace(mobile),
};

export const NotFound: Story = {
  args: { result: topicResult },
  render: () => <LibraryDiscoveryNotFound />,
  name: "Not found",
};

export const UnexpectedError: Story = {
  args: { result: topicResult },
  render: () => <LibraryDiscoveryUnexpectedError onRetry={() => undefined} />,
  name: "Unexpected error",
};

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const storyWindow = canvasElement.ownerDocument.defaultView;
  if (storyWindow === null) throw new Error("Story window is unavailable");
  await expect(
    canvasElement.ownerDocument.documentElement.scrollWidth,
  ).toBeLessThanOrEqual(storyWindow.innerWidth + 1);
}
