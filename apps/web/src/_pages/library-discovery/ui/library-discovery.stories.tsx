import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { LibraryDiscoveryResult } from "@/features/library-discovery";
import { guideOnlyOffer } from "@/workshop/billing.fixtures";
import type { MaterialPreview } from "@/entities/material";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import {
  LibraryDiscoveryLoading,
  LibraryDiscoveryNotFound,
  LibraryDiscoveryUnexpectedError,
  LibraryDiscoveryUnavailable,
  LibraryDiscoveryView,
} from "./library-discovery-view";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
] satisfies readonly ApplicationNavigationItem[];

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

function ProductionShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <ApplicationShell
      currentPath="/topics/platform"
      navigationItems={navigationItems}
      mobileNavigationItems={[...navigationItems, { href: "/account", icon: "profile", label: "Профиль" }]}
    >
      {children}
    </ApplicationShell>
  );
}

const meta = {
  component: LibraryDiscoveryView,
  decorators: [
    (Story) => (
      <ProductionShell>
        <Story />
      </ProductionShell>
    ),
  ],
  parameters: {
    nextjs: { appDirectory: true },
  },
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
      "/guides/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252Flibrary",
    );
    for (const coverId of [
      "02000000-0000-4000-8000-000000000061",
      "02000000-0000-4000-8000-000000000062",
    ]) {
      await expect(
        canvasElement.querySelector(`[data-content-cover-id="${coverId}"]`),
      ).toBeInTheDocument();
    }
  },
};

export const TopicMobile: Story = {
  args: { result: topicResult },
  globals: { viewport: { isRotated: false, value: "mobile360" } },
  name: "Topic · mobile",
};

export const TopicLongTitle: Story = {
  args: {
    result: {
      ...topicResult,
      reference: { ...topicResult.reference, name: "Т".repeat(120) },
    },
  },
  globals: { viewport: { isRotated: false, value: "mobile360" } },
  name: "Topic · long title",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const SeriesDesktop: Story = {
  args: { result: seriesResult },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Series · ordered desktop",
  play: async ({ canvasElement }) => {
    const orderedItems = canvasElement.querySelectorAll("[data-series-ordinal]");
    await expect([...orderedItems].map((item) => item.getAttribute("data-series-ordinal"))).toEqual([
      "1",
      "2",
    ]);
    await expect(
      canvasElement.querySelector('[data-access-cover="locked"]'),
    ).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(
        '[data-content-cover-id="02000000-0000-4000-8000-000000000063"]',
      ),
    ).toBeInTheDocument();
  },
};

/**
 * У руководства есть своя цена: покупка руководства — главный путь, подписка остаётся вторым.
 * Без цены остаётся прежний CTA на тарифы, поэтому оба состояния показаны рядом.
 */
export const SeriesForSaleDesktop: Story = {
  args: { result: seriesResult, guideOffer: guideOnlyOffer },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Series · guide for sale desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: /Купить за/u }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Посмотреть подписку" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/навсегда/u)).toBeInTheDocument();
  },
};

export const SeriesForSaleMobile: Story = {
  args: { result: seriesResult, guideOffer: guideOnlyOffer },
  globals: { viewport: { isRotated: false, value: "mobile360" } },
  name: "Series · guide for sale mobile",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const SeriesNotForSale: Story = {
  args: { result: seriesResult },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Series · guide not for sale",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("link", { name: /Купить за/u }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Посмотреть тарифы" }),
    ).toBeInTheDocument();
  },
};

export const SeriesLongTitle: Story = {
  args: {
    result: {
      ...seriesResult,
      reference: { ...seriesResult.reference, name: "П".repeat(120) },
    },
  },
  globals: { viewport: { isRotated: false, value: "mobile360" } },
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
      reference: { name: "Новая руководство", slug: "new-series", summary: "" },
      relatedSeries: [],
      topics: [],
    },
  },
  name: "Series · empty",
};

export const Unavailable: Story = {
  args: { result: topicResult },
  render: () => <LibraryDiscoveryUnavailable kind="topic" slug="platform" />,
  name: "Unavailable",
};

export const Loading: Story = {
  args: { result: topicResult },
  render: () => <LibraryDiscoveryLoading />,
  name: "Loading",
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

const connectedStepsResult = {
  ...seriesResult,
  reference: { cover: null, name: "Релиз своего проекта", slug: "release", summary: "Видео, заметки и последовательные инструкции в одном руководстве." },
  items: [
    { title: "Как устроен релиз моего проекта", format: "Видео", formatSlug: "video", summary: "От коммита до работающего сервиса: сборка, конфигурация, публикация и откат релиза." },
    { title: "Подготовка приложения", format: "Гайд", formatSlug: "guide", stepGroup: "От проекта до релиза" },
    { title: "Разбираем Docker на реальном примере", format: "Видео", formatSlug: "video", summary: "Собираем образ приложения, настраиваем сеть и тома Docker Compose, читаем логи при неудачном запуске." },
    { title: "Памятка по секретам", format: "Заметка", formatSlug: "note" },
    { title: "Настройка окружения", format: "Гайд", formatSlug: "guide", stepGroup: "От проекта до релиза" },
    { title: "Первый деплой", format: "Гайд", formatSlug: "guide", stepGroup: "От проекта до релиза" },
  ].map((definition, index) => ({
    ...materials[0], ...definition, slug: `release-${String(index)}`,
    summary: definition.summary ?? "Материал общего руководства: изучайте в предложенном порядке или возвращайтесь к нужному шагу.",
    seriesMemberships: [{ name: "Релиз своего проекта", slug: "release", ordinal: index + 1, stepGroup: definition.stepGroup ?? null }],
  })),
} satisfies LibraryDiscoveryResult;

const overviewVideo = connectedStepsResult.items[0];
const dockerVideo = connectedStepsResult.items[2];
if (overviewVideo === undefined || dockerVideo === undefined) throw new Error("Missing release video fixtures");

export const ConnectedStepsDesktop: Story = {
  args: { result: connectedStepsResult },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Шаг 1 из 3")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Шаг 2 из 3")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Шаг 3 из 3")).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("[data-series-ordinal]")).toHaveLength(6);
    await expect(canvasElement.querySelectorAll("[data-series-step]")).toHaveLength(0);
    const rows = canvasElement.querySelectorAll("[data-series-ordinal]");
    const markers = canvasElement.querySelectorAll<HTMLElement>("[data-series-marker]");
    await expect(markers).toHaveLength(6);
    const firstMarker = markers[0];
    if (firstMarker === undefined) throw new Error("Missing Series ordinal marker");
    for (const [index, marker] of [...markers].entries()) {
      await expect(marker).toHaveTextContent(String(index + 1));
      const rail = rows[index]?.querySelector("[data-series-rail]")?.getBoundingClientRect();
      const markerBox = marker.getBoundingClientRect();
      if (rail === undefined) throw new Error("Missing mixed-Series rail");
      await expect(Math.abs(rail.x + rail.width / 2 - markerBox.x - markerBox.width / 2)).toBeLessThan(1);
      const style = getComputedStyle(marker);
      await expect(style.backgroundColor).toBe(getComputedStyle(firstMarker).backgroundColor);
    }
    const guide = canvas.getByRole("heading", { name: "Подготовка приложения" }).closest("article");
    if (guide === null) throw new Error("Missing guide card");
    await expect(within(guide).queryByText("Шаг 1 из 3")).not.toBeInTheDocument();
    for (const summary of [overviewVideo.summary, dockerVideo.summary]) {
      const element = canvas.getByText(summary);
      if (canvasElement.ownerDocument.documentElement.clientWidth < 640) {
        await expect(element).not.toBeVisible();
        continue;
      }
      await expect(element).toBeVisible();
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      await expect(element.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight + 1);
    }
    await expectNoHorizontalOverflow(canvasElement);
  },
};
export const ConnectedStepsMobile: Story = {
  ...ConnectedStepsDesktop,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

const literalSummary = '<img src=x onerror="alert(1)"> Команда остаётся текстом.';
export const VideoSummaryIsPlainText: Story = {
  args: { result: { ...connectedStepsResult, items: [{ ...overviewVideo, summary: literalSummary }] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(literalSummary)).toBeVisible();
    await expect(canvasElement.querySelector("img[onerror]")).toBeNull();
    await expect(canvasElement.querySelectorAll("[data-series-rail]")).toHaveLength(0);
    await expect(canvasElement.querySelectorAll("[data-series-step]")).toHaveLength(0);
  },
};
