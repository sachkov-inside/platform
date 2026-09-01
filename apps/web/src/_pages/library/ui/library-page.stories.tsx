import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { createLibraryCatalogQueryOptions } from "@/_pages/library/model/library-catalog-query";
import type { LibraryCatalogPage } from "@/_pages/library/model/library-view";
import type { LibrarySearchQuery } from "@/_pages/library/model/library-search-query";
import {
  LibraryLoading,
  LibraryPage,
  LibraryUnexpectedError,
} from "@/_pages/library/ui/library-page";
import { LibraryCatalogQueryView } from "@/_pages/library/ui/library-page-query.client";
import { InfiniteLibraryCatalog } from "@/_pages/library/ui/infinite-library-catalog.client";
import type { MaterialPreview } from "@/entities/material";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

const catalogItems = [
  {
    access: "membership",
    availability: "locked",
    format: "Видео",
    preview: {
      duration: "38:42",
      label: "Пять стадий delivery от ready issue до owner-approved merge",
      steps: ["Issue", "Ветка", "Checks", "PR", "GO"],
    },
    seriesMemberships: [
      { name: "Создание Platform Inside", ordinal: 5, slug: "platform-inside" },
    ],
    slug: "platform-delivery",
    summary:
      "Как связать issue, task branch, evidence, pull request и явный owner GO.",
    tags: ["developer pipeline", "harness"],
    title: "Developer Pipeline и owner-controlled delivery",
    topic: "Product engineering",
    topicSlug: "product-engineering",
  },
  {
    access: "free",
    availability: "available",
    format: "Гайд",
    seriesMemberships: [],
    slug: "public-agent-skills",
    summary:
      "Как превратить повторяемый инженерный процесс в короткую repository-owned инструкцию.",
    tags: ["agent skills", "workflow"],
    title: "Публичные skills для agent-first setup",
    topic: "AI-first engineering",
    topicSlug: "ai-first-engineering",
  },
  {
    access: "membership",
    availability: "locked",
    format: "Гайд",
    seriesMemberships: [],
    slug: "resume-hypotheses",
    summary:
      "Практический разбор воронки поиска, структуры резюме и проверки гипотез.",
    tags: ["job search", "resume"],
    title: "Поиск работы и резюме в IT",
    topic: "Карьера",
    topicSlug: "career",
  },
] as const satisfies readonly MaterialPreview[];

const defaultQuery = {
  after: null,
  formatSlugs: [],
  q: "",
  seriesSlugs: [],
  sort: "relevance",
  topicSlugs: [],
} as const satisfies LibrarySearchQuery;

const catalogFacets = {
  formats: [
    { count: 2, id: "format-guide", name: "Гайд", slug: "guide" },
    { count: 1, id: "format-video", name: "Видео", slug: "video" },
  ],
  series: [
    {
      count: 1,
      id: "series-platform-inside",
      name: "Создание Platform Inside",
      slug: "platform-inside",
    },
  ],
  topics: [
    {
      count: 1,
      id: "topic-ai-first",
      name: "AI-first engineering",
      slug: "ai-first-engineering",
    },
    {
      count: 1,
      id: "topic-career",
      name: "Карьера",
      slug: "career",
    },
    {
      count: 1,
      id: "topic-product-engineering",
      name: "Product engineering",
      slug: "product-engineering",
    },
  ],
} as const;

type ReadyCatalogPage = Extract<LibraryCatalogPage, { readonly kind: "ready" }>;

function createCatalogPage(pageIndex: number, itemCount = 12): ReadyCatalogPage {
  const source = catalogItems[pageIndex % catalogItems.length] ?? catalogItems[0];

  return {
    facets: catalogFacets,
    items: Array.from({ length: itemCount }, (_, itemIndex) => ({
      ...source,
      slug: `story-material-${String(pageIndex + 1)}-${String(itemIndex + 1)}`,
      title: `Материал ${String(pageIndex + 1)}.${String(itemIndex + 1)}`,
    })),
    kind: "ready",
    nextCursor: `story-cursor-${String(pageIndex + 1)}`,
    totalCount: 24,
  };
}

function createCatalogPages(count: number): readonly ReadyCatalogPage[] {
  return Array.from({ length: count }, (_, pageIndex) =>
    createCatalogPage(pageIndex),
  );
}

function AutoLoadCatalogHarness() {
  const [pageCount, setPageCount] = useState(1);

  return (
    <InfiniteLibraryCatalog
      hasNextPage={pageCount < 2}
      isFetchNextPageError={false}
      isFetchingNextPage={false}
      onLoadNextPage={() => {
        setPageCount(2);
      }}
      pages={createCatalogPages(pageCount)}
      totalCount={24}
    />
  );
}

function RetryCatalogHarness() {
  const [attempts, setAttempts] = useState(0);

  return (
    <>
      <output aria-label="Попыток повторной загрузки">{attempts}</output>
      <InfiniteLibraryCatalog
        hasNextPage
        isFetchNextPageError
        isFetchingNextPage={false}
        onLoadNextPage={() => {
          setAttempts((current) => current + 1);
        }}
        pages={createCatalogPages(1)}
        totalCount={12}
      />
    </>
  );
}

function CachedCatalogNavigationHarness() {
  const [screen, setScreen] = useState<"catalog" | "detail" | "idle">("idle");
  const [requestCount, setRequestCount] = useState(0);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30_000 },
        },
      }),
  );
  const createQueryOptions = useMemo(
    () => (query: LibrarySearchQuery) =>
      createLibraryCatalogQueryOptions(
        ({ after }) => {
          setRequestCount((current) => current + 1);
          return Promise.resolve(
            after === undefined
              ? createCatalogPage(0)
              : { ...createCatalogPage(1), nextCursor: null },
          );
        },
        query,
      ),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="fixed right-4 top-4 z-50 rounded-xl bg-background p-2 shadow-card">
        <output aria-label="Запросов к каталогу" className="mr-3">
          {requestCount}
        </output>
        {screen === "idle" ? (
          <button
            onClick={() => {
              queryClient.clear();
              setScreen("catalog");
            }}
            type="button"
          >
            Начать проверку
          </button>
        ) : null}
        {screen === "catalog" ? (
          <button
            onClick={() => {
              setScreen("detail");
            }}
            type="button"
          >
            Открыть материал
          </button>
        ) : null}
        {screen === "detail" ? (
          <button
            onClick={() => {
              setScreen("catalog");
            }}
            type="button"
          >
            Вернуться в базу знаний
          </button>
        ) : null}
      </div>
      {screen === "catalog" ? (
        <LibraryCatalogQueryView
          createQueryOptions={createQueryOptions}
          initialQuery={defaultQuery}
        />
      ) : null}
      {screen === "detail" ? <p>Карточка материала</p> : null}
    </QueryClientProvider>
  );
}

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
  args: { onQueryChange: () => undefined, query: defaultQuery },
  component: LibraryPage,
  decorators: [
    (Story) => (
      <ProductionShell>
        <Story />
      </ProductionShell>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Production-owned client Library presentation and Storybook fixtures, including immediate filters plus canonical Topic and Series links.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Library/Production",
} satisfies Meta<typeof LibraryPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReadyDesktop: Story = {
  args: {
    result: {
      facets: catalogFacets,
      items: catalogItems,
      kind: "ready",
      nextCursor: null,
      totalCount: catalogItems.length,
    },
  },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Ready · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cards = Array.from(canvasElement.querySelectorAll<HTMLElement>("article"));
    const firstCard = cards[0];
    const grid = canvasElement.querySelector<HTMLElement>("[data-material-grid]");

    await expect(cards).toHaveLength(3);
    if (firstCard === undefined) {
      throw new Error("First Material card is missing");
    }
    await expect(within(firstCard).getAllByRole("link")).toHaveLength(3);
    await expect(
      within(firstCard).getByRole("link", { name: catalogItems[0].title }),
    ).toHaveAttribute("href", "/materials/platform-delivery");
    await expect(
      within(firstCard).getByRole("link", { name: "Product engineering" }),
    ).toHaveAttribute("href", "/topics/product-engineering");
    await expect(
      within(firstCard).getByRole("link", {
        name: "Создание Platform Inside № 5",
      }),
    ).toHaveAttribute("href", "/series/platform-inside");
    await expect(canvas.getByText("Бесплатно")).toBeInTheDocument();
    await expect(canvas.getAllByText("Для участников")).toHaveLength(2);
    await expect(
      canvas.getByRole("link", { name: catalogItems[1].title }),
    ).toHaveAttribute("href", "/materials/public-agent-skills");
    if (grid === null) {
      throw new Error("Material grid is missing");
    }
    await expect(getComputedStyle(grid).gridTemplateColumns.split(" ")).toHaveLength(2);
  },
};

export const ReadyMobile: Story = {
  args: {
    result: {
      facets: catalogFacets,
      items: catalogItems,
      kind: "ready",
      nextCursor: null,
      totalCount: catalogItems.length,
    },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Ready · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grid = canvasElement.querySelector<HTMLElement>("[data-material-grid]");

    await expect(canvas.getByRole("heading", { name: "База знаний" })).toBeInTheDocument();
    if (grid === null) {
      throw new Error("Material grid is missing");
    }
    await expect(getComputedStyle(grid).gridTemplateColumns.split(" ")).toHaveLength(1);
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
    const firstCardLink = canvas.getByRole("link", {
      name: catalogItems[0].title,
    });
    for (
      let tabIndex = 0;
      tabIndex < 12 && canvasElement.ownerDocument.activeElement !== firstCardLink;
      tabIndex += 1
    ) {
      await userEvent.tab();
    }
    await expect(firstCardLink).toHaveFocus();
  },
};

export const SearchResultsDesktop: Story = {
  args: {
    query: {
      ...defaultQuery,
      q: "developer pipeline",
      topicSlugs: ["product-engineering"],
    },
    result: {
      facets: catalogFacets,
      items: [catalogItems[0]],
      kind: "ready",
      nextCursor: null,
      totalCount: 1,
    },
  },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Search results · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Поиск по базе знаний")).toHaveValue(
      "developer pipeline",
    );
    await expect(
      canvas.getByRole("checkbox", { name: /Product engineering/u }),
    ).toBeChecked();
    await expect(canvas.getByText("1 материал найден")).toBeInTheDocument();
  },
};

export const SearchResultsMobile: Story = {
  ...SearchResultsDesktop,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Search results · mobile",
};

export const NoSearchResults: Story = {
  args: {
    query: { ...defaultQuery, q: "nothing can match" },
    result: {
      facets: catalogFacets,
      items: [],
      kind: "ready",
      nextCursor: null,
      totalCount: 0,
    },
  },
  name: "Search · no results",
};

export const ContinuedCatalog: Story = {
  args: {
    result: {
      facets: catalogFacets,
      kind: "ready",
      items: catalogItems,
      nextCursor: "representative-cursor",
      totalCount: 24,
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("article")).toHaveLength(3);
    await expect(
      within(canvasElement).queryByRole("link", { name: "Следующая страница" }),
    ).not.toBeInTheDocument();
  },
};

export const AutoLoadsContinuation: Story = {
  args: { result: { kind: "empty" } },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Infinite catalog · auto load",
  render: () => <AutoLoadCatalogHarness />,
  play: async ({ canvasElement }) => {
    const main = canvasElement.querySelector<HTMLElement>("main");
    if (main === null) {
      throw new Error("Application shell main scroll container is missing");
    }

    main.scrollTo({ top: main.scrollHeight });
    await waitFor(() =>
      expect(
        within(canvasElement).getByText(
          "24 материала найдено · 24 материала загружено",
        ),
      ).toBeInTheDocument(),
    );
  },
};

export const RendersLoadedPages: Story = {
  args: { result: { kind: "empty" } },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Infinite catalog · loaded pages",
  render: () => (
    <InfiniteLibraryCatalog
      hasNextPage={false}
      isFetchNextPageError={false}
      isFetchingNextPage={false}
      onLoadNextPage={() => undefined}
      pages={createCatalogPages(8)}
      totalCount={96}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(96);
    await expect(within(canvasElement).getByText("Материал 8.12")).toBeInTheDocument();
  },
};

export const RetriesContinuationExplicitly: Story = {
  args: { result: { kind: "empty" } },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Infinite catalog · retry",
  render: () => <RetryCatalogHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const attempts = canvas.getByRole("status", {
      name: "Попыток повторной загрузки",
    });

    await expect(attempts).toHaveTextContent("0");
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await expect(attempts).toHaveTextContent("1");
  },
};

export const ReusesCachedCatalog: Story = {
  args: { result: { kind: "empty" } },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Infinite catalog · cached remount",
  render: () => <CachedCatalogNavigationHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Начать проверку" }));
    await waitFor(() =>
      expect(canvas.getByText("Материал 1.12")).toBeInTheDocument(),
    );
    const loadMore = canvas.queryByRole("button", { name: "Показать ещё" });
    if (loadMore !== null) {
      await userEvent.click(loadMore);
    }
    await waitFor(() =>
      expect(canvas.getByText("Материал 2.12")).toBeInTheDocument(),
    );
    await expect(
      canvas.getByRole("status", { name: "Запросов к каталогу" }),
    ).toHaveTextContent("2");
    await userEvent.click(canvas.getByRole("button", { name: "Открыть материал" }));
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуться в базу знаний" }),
    );
    await waitFor(() =>
      expect(canvas.getByText("Материал 2.12")).toBeInTheDocument(),
    );
    await expect(
      canvas.getByRole("status", { name: "Запросов к каталогу" }),
    ).toHaveTextContent("2");
  },
};

export const Loading: Story = {
  args: { result: { kind: "empty" } },
  render: () => <LibraryLoading />,
};

export const Empty: Story = {
  args: { result: { kind: "empty" } },
};

export const Unavailable: Story = {
  args: { result: { kind: "unavailable" } },
  name: "Controlled error",
};

export const UnexpectedError: Story = {
  args: { result: { kind: "empty" } },
  name: "Unexpected error",
  render: () => <LibraryUnexpectedError onRetry={() => undefined} />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("heading", { level: 1, name: "База знаний" }),
    ).toBeInTheDocument();
  },
};
