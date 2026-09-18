import { Suspense, use, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { LibraryDiscoveryResult } from "@/features/library-discovery";
import type { MaterialPreview } from "@/entities/material";
import { GuideProgrammeView } from "./guide-programme-view.client";
import {
  LibraryDiscoveryLoading,
  LibraryDiscoveryNotFound,
  LibraryDiscoveryUnexpectedError,
  LibraryDiscoveryUnavailable,
  LibraryDiscoveryView,
} from "./library-discovery-view";
import { boxOf, desktop, mobile, originOf, settleStoryFrame, stagedLoaders, stagedLoadingOf, type StagedLoading, type StoryViewport } from "@/workshop/loads-in-place";
import { publicPageEnvironment } from "@/workshop/story-environment";

/**
 * Истории программы живут под общим meta страницы открытия, поэтому её результат сужается здесь
 * один раз — настоящей проверкой, а не приведением типа.
 */
function programmeResult(
  result: ComponentProps<typeof LibraryDiscoveryView>["result"],
): ComponentProps<typeof GuideProgrammeView>["result"] {
  if (result.discoveryKind !== "series") {
    throw new Error("Истории программы строятся на результате продукта");
  }
  return result;
}

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

const seriesChapters = [
  {
    id: "72000000-0000-4000-8000-000000000801",
    name: "Основа продукта",
    summary: "Разбираем границы, сценарии и первый вертикальный срез.",
    materialIds: [],
  },
  {
    id: "72000000-0000-4000-8000-000000000802",
    name: "Проверки и релизы",
    summary: "Собираем CI, образ и подтверждённое обновление.",
    materialIds: [],
  },
];
const seriesResult = {
  chapters: [],
  discoveryKind: "series",
  hasNext: false,
  items: materials,
  kind: "ready",
  reference: {
    cover: {
      coverId: "02000000-0000-4000-8000-000000000063",
      renditions: [{ height: 540, width: 960 }],
    },
    name: "Создание Platform Inside",
    slug: "platform-inside",
    summary: "Последовательный путь создания Platform.",
  },
  relatedSeries: [],
  topics: [{ id: "topic-platform", name: "Platform", slug: "platform" }],
} as const satisfies LibraryDiscoveryResult;

const environment = publicPageEnvironment("/topics/platform");

const meta = {
  ...environment,
  component: LibraryDiscoveryView,
  title: "Pages/Mobile-first Platform/Collections",
} satisfies Meta<typeof LibraryDiscoveryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TopicDesktop: Story = {
  args: { result: topicResult },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Topic · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible();
    await expect(canvasElement.querySelector("[data-playlist-card]")).toHaveAttribute(
      "href",
      "/guides/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252F",
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

export const SeriesDesktop: Story = {
  args: { result: seriesResult },
  render: (storyArgs) => <GuideProgrammeView learning={{ kind: "guest" }} result={programmeResult(storyArgs.result)} />,
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Series · ordered desktop",
  play: async ({ canvasElement }) => {
    const orderedItems = canvasElement.querySelectorAll("[data-series-ordinal]");
    await expect([...orderedItems].map((item) => item.getAttribute("data-series-ordinal"))).toEqual([
      "1",
      "2",
    ]);
    await expect(
      canvasElement.querySelector('[data-material-availability="locked"]'),
    ).toBeInTheDocument();
  },
};

/**
 * Страница продукта рассказывает и никуда не продаёт: цену читатель встречает в программе.
 * Отсюда ведёт одно действие — «Открыть программу».
 */
export const SeriesProductDesktop: Story = {
  args: { result: { ...seriesResult, chapters: seriesChapters } },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Series · product desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: /Открыть программу/u }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: /Купить за/u })).not.toBeInTheDocument();
    await expect(canvas.getByText("Что внутри продукта")).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(
        '[data-content-cover-id="02000000-0000-4000-8000-000000000063"]',
      ),
    ).toBeInTheDocument();
  },
};

export const SeriesProductMobile: Story = {
  args: { result: { ...seriesResult, chapters: seriesChapters } },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Series · product mobile",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const SeriesLongTitle: Story = {
  args: {
    result: {
      ...seriesResult,
      reference: { ...seriesResult.reference, name: "П".repeat(120) },
    },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Series · long title",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const EmptySeries: Story = {
  args: {
    result: {
      chapters: [],
      discoveryKind: "series",
      kind: "empty",
      reference: { name: "Новый продукт", slug: "new-series", summary: "" },
      relatedSeries: [],
      topics: [],
    },
  },
  name: "Series · empty",
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
async function heroOpensAtTheSamePlace({ canvasElement }: { canvasElement: HTMLElement }) {
  const frame = canvasElement.querySelector("[data-discovery-frame]");
  if (frame === null) throw new Error("Каркас подборки не отрисован");
  await expect(getComputedStyle(frame).containerName).toBe("discovery");
  // Прежний скелет обрезал себя до max-w-[58rem]: ширина и была поломкой, не только имя контейнера.
  await expect(getComputedStyle(frame).maxWidth).toBe("none");
  const [breadcrumb, hero] = frame.children;
  if (breadcrumb === undefined || hero === undefined) throw new Error("Первый экран подборки неполон");
  const breadcrumbBox = breadcrumb.getBoundingClientRect();
  await expect(Math.round(breadcrumbBox.top - frame.getBoundingClientRect().top)).toBe(28);
  await expect(Math.round(breadcrumbBox.height)).toBe(40);
  await expect(Math.round(hero.getBoundingClientRect().top - breadcrumbBox.bottom)).toBe(20);
}

/** Тема целиком общая (ADR 0026): под скелетом маршрута сразу готовая страница. */
function StagedTopic({ sequence }: { readonly sequence: StagedLoading }) {
  return <Suspense fallback={<LibraryDiscoveryLoading />}><TopicPage sequence={sequence} /></Suspense>;
}

function TopicPage({ sequence }: { readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return <LibraryDiscoveryView result={topicResult} />;
}

/** Ряд возврата и начало шапки темы: высота шапки зависит от названия и описания. */
const topicFrameOf = (canvasElement: HTMLElement) => ({
  breadcrumb: boxOf(canvasElement, "[data-discovery-frame] > :nth-child(1)"),
  hero: originOf(boxOf(canvasElement, "[data-discovery-frame] > :nth-child(2)")),
});

function topicLoadsInPlace({ globals, width }: StoryViewport): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => <StagedTopic sequence={stagedLoadingOf(loaded)} />,
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const canvas = within(canvasElement);
      await expect(await canvas.findByLabelText("Подборка загружается")).toHaveAttribute("aria-busy", "true");
      const skeleton = topicFrameOf(canvasElement);

      stagedLoadingOf(loaded).deliverSharedPart();
      await canvas.findByRole("heading", { level: 1, name: "Platform" });

      await expect(skeleton).toEqual(topicFrameOf(canvasElement));
    },
  };
}

export const TopicLoadsInPlace: Story = { args: { result: topicResult }, ...topicLoadsInPlace(desktop) };
export const TopicLoadsInPlaceMobile: Story = { args: { result: topicResult }, ...topicLoadsInPlace(mobile) };

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

const connectedStepsResult = {
  ...seriesResult,
  reference: { cover: null, name: "Релиз своего проекта", slug: "release", summary: "Видео, заметки и последовательные инструкции в одном продукте." },
  items: [
    { title: "Как устроен релиз моего проекта", format: "Видео", formatSlug: "video", summary: "От коммита до работающего сервиса: сборка, конфигурация, публикация и откат релиза." },
    { title: "Подготовка приложения", format: "Гайд", formatSlug: "guide", stepGroup: "От проекта до релиза" },
    { title: "Разбираем Docker на реальном примере", format: "Видео", formatSlug: "video", summary: "Собираем образ приложения, настраиваем сеть и тома Docker Compose, читаем логи при неудачном запуске." },
    { title: "Памятка по секретам", format: "Заметка", formatSlug: "note" },
    { title: "Настройка окружения", format: "Гайд", formatSlug: "guide", stepGroup: "От проекта до релиза" },
    { title: "Первый деплой", format: "Гайд", formatSlug: "guide", stepGroup: "От проекта до релиза" },
  ].map((definition, index) => ({
    ...materials[0], ...definition, slug: `release-${String(index)}`,
    summary: definition.summary ?? "Материал общего продукта: изучайте в предложенном порядке или возвращайтесь к нужному шагу.",
    seriesMemberships: [{ name: "Релиз своего проекта", slug: "release", ordinal: index + 1, stepGroup: definition.stepGroup ?? null }],
  })),
} satisfies LibraryDiscoveryResult;

const overviewVideo = connectedStepsResult.items[0];
const dockerVideo = connectedStepsResult.items[2];
if (overviewVideo === undefined || dockerVideo === undefined) throw new Error("Missing release video fixtures");

export const ConnectedStepsDesktop: Story = {
  args: { result: connectedStepsResult },
  render: (storyArgs) => <GuideProgrammeView learning={{ kind: "guest" }} result={programmeResult(storyArgs.result)} />,
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Шаг 1 из 3")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Шаг 2 из 3")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Шаг 3 из 3")).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("[data-series-ordinal]")).toHaveLength(6);
    await expect(canvasElement.querySelectorAll("[data-series-step]")).toHaveLength(0);
    const rows = canvasElement.querySelectorAll("[data-series-ordinal]");
    await expect(canvasElement.querySelectorAll("[data-series-marker]")).toHaveLength(0);
    await expect(canvasElement.querySelectorAll("[data-series-rail]")).toHaveLength(0);
    for (const [index, row] of [...rows].entries()) {
      await expect(row).toHaveTextContent(`${String(index + 1)}урок`);
    }
    const guide = canvas.getByRole("heading", { name: "Подготовка приложения" }).closest("article");
    if (guide === null) throw new Error("Missing guide card");
    await expect(within(guide).queryByText("Шаг 1 из 3")).not.toBeInTheDocument();
    for (const summary of [overviewVideo.summary, dockerVideo.summary]) {
      await expect(canvas.queryByText(summary)).not.toBeInTheDocument();
    }
    await expectNoHorizontalOverflow(canvasElement);
  },
};
export const ConnectedStepsMobile: Story = {
  ...ConnectedStepsDesktop,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

const literalSummary = '<img src=x onerror="alert(1)"> Команда остаётся текстом.';
export const VideoSummaryIsNotShown: Story = {
  args: { result: { ...connectedStepsResult, items: [{ ...overviewVideo, summary: literalSummary }] } },
  render: (storyArgs) => <GuideProgrammeView learning={{ kind: "guest" }} result={programmeResult(storyArgs.result)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(literalSummary)).not.toBeInTheDocument();
    await expect(canvasElement.querySelector("img[onerror]")).toBeNull();
    await expect(canvasElement.querySelectorAll("[data-series-rail]")).toHaveLength(0);
    await expect(canvasElement.querySelectorAll("[data-series-step]")).toHaveLength(0);
  },
};
