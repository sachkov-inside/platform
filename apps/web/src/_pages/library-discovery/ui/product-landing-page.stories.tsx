import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import type { MaterialPreview } from "@/entities/material";
import type { LibraryDiscoveryResult } from "@/features/library-discovery";
import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import {
  LibraryDiscoveryNotFound,
  LibraryDiscoveryUnavailable,
  LibraryDiscoveryUnexpectedError,
  LibraryDiscoveryView,
} from "./library-discovery-view";

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
    access: "closed",
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

const chapters = [
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

const productResult = {
  chapters,
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

/** Страница продукта без особого оформления: `PublishedSeriesPage` рисует её через развилку открытия. */
const meta = {
  ...publicPageEnvironment("/products/platform-inside"),
  component: LibraryDiscoveryView,
  title: "Pages/Product/Product",
  tags: ["autodocs"],
  args: { result: productResult },
} satisfies Meta<typeof LibraryDiscoveryView>;
export default meta;
type Story = StoryObj<typeof meta>;

const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;
const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const storyWindow = canvasElement.ownerDocument.defaultView;
  if (storyWindow === null) throw new Error("Story window is unavailable");
  await expect(
    canvasElement.ownerDocument.documentElement.scrollWidth,
  ).toBeLessThanOrEqual(storyWindow.innerWidth + 1);
}

/**
 * Страница продукта рассказывает и никуда не продаёт: цену читатель встречает в программе.
 * Отсюда ведёт одно действие — «Открыть программу».
 */
export const Desktop: Story = {
  globals: desktop,
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(
      canvas.getByRole("link", { name: /Открыть программу/u }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: /Купить за/u }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByText("Что внутри продукта")).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(
        '[data-content-cover-id="02000000-0000-4000-8000-000000000063"]',
      ),
    ).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  globals: mobile,
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const LongTitle: Story = {
  args: {
    result: {
      ...productResult,
      reference: { ...productResult.reference, name: "П".repeat(120) },
    },
  },
  globals: mobile,
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

/** Продукт опубликован, а материалов в нём пока нет. */
export const Empty: Story = {
  args: {
    result: {
      chapters: [],
      discoveryKind: "series",
      kind: "empty",
      reference: {
        name: "Новый продукт",
        slug: "platform-inside",
        summary: "",
      },
      relatedSeries: [],
      topics: [],
    },
  },
  globals: desktop,
};

/** Каталог не ответил: `PublishedSeriesPage` показывает сбой подборки с повтором. */
export const Unavailable: Story = {
  globals: mobile,
  render: () => <LibraryDiscoveryUnavailable />,
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Подборка временно недоступна",
      }),
    ).toBeVisible();
  },
};

/** `products/[slug]/not-found.tsx`. */
export const NotFound: Story = {
  globals: mobile,
  render: () => <LibraryDiscoveryNotFound />,
};

/** `products/[slug]/error.tsx`: повтор перечитывает страницу с сервера. */
export const UnexpectedError: Story = {
  globals: desktop,
  render: () => <LibraryDiscoveryUnexpectedError onRetry={fn()} />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Повторить" }),
    ).toBeVisible();
  },
};
