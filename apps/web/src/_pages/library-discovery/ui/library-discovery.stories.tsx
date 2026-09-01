import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import {
  RelatedMaterialsSection,
  type LibraryDiscoveryResult,
} from "@/features/library-discovery";
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
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
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
  reference: { name: "Platform", slug: "platform" },
} as const satisfies LibraryDiscoveryResult;

const seriesResult = {
  discoveryKind: "series",
  hasNext: false,
  items: materials,
  kind: "ready",
  reference: { name: "Создание Platform Inside", slug: "platform-inside" },
} as const satisfies LibraryDiscoveryResult;

function ProductionShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <ApplicationShell
      accountLabel="Гость"
      currentPath="/library"
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
  title: "Pages/Library discovery/Production",
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
    await expect(canvas.getByRole("link", { name: "Создание Platform Inside" })).toHaveAttribute(
      "href",
      "/series/platform-inside",
    );
  },
};

export const TopicMobile: Story = {
  args: { result: topicResult },
  globals: { viewport: { isRotated: false, value: "mobile360" } },
  name: "Topic · mobile",
};

export const SeriesDesktop: Story = {
  args: { result: seriesResult },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Series · ordered desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const orderedItems = canvasElement.querySelectorAll("[data-series-ordinal]");
    await expect([...orderedItems].map((item) => item.getAttribute("data-series-ordinal"))).toEqual([
      "1",
      "2",
    ]);
    await expect(canvas.getByText("Для участников")).toBeVisible();
  },
};

export const EmptySeries: Story = {
  args: {
    result: {
      discoveryKind: "series",
      kind: "empty",
      reference: { name: "Новый плейлист", slug: "new-series" },
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

export const RelatedReady: Story = {
  args: { result: topicResult },
  render: () => (
    <RelatedMaterialsSection
      result={{
        discoveryKind: "related",
        hasNext: false,
        items: materials,
        kind: "ready",
        reference: { name: "Как устроен Inside Platform", slug: "inside-platform-overview" },
      }}
      sourceSlug="inside-platform-overview"
    />
  ),
  name: "Related · ready",
};

export const RelatedEmpty: Story = {
  args: { result: topicResult },
  render: () => (
    <RelatedMaterialsSection
      result={{
        discoveryKind: "related",
        kind: "empty",
        reference: { name: "Как устроен Inside Platform", slug: "inside-platform-overview" },
      }}
      sourceSlug="inside-platform-overview"
    />
  ),
  name: "Related · empty",
};

export const RelatedUnavailable: Story = {
  args: { result: topicResult },
  render: () => (
    <RelatedMaterialsSection
      result={{ kind: "unavailable" }}
      sourceSlug="inside-platform-overview"
    />
  ),
  name: "Related · unavailable",
};
