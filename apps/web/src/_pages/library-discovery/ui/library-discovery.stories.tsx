import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { LibraryDiscoveryResult } from "@/features/library-discovery";
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

const mobileNavigationItems = [
  ...navigationItems,
  { href: "/account", icon: "profile", label: "Профиль" },
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
      accountLabel="Гость"
      currentPath="/topics/platform"
      mobileNavigationItems={mobileNavigationItems}
      navigationItems={navigationItems}
      sidebarDefaultPinned
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
      "/series/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252Flibrary",
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
      discoveryKind: "series",
      kind: "empty",
      reference: { name: "Новый плейлист", slug: "new-series", summary: "" },
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
