"use client";

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowUpRight,
  ListVideo,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import {
  MaterialCard,
  materialFixtures,
  type MaterialPreviewFixture,
  type MaterialSeriesFixture,
} from "@/workshop/material-preview.prototype";
import { LibraryFilters } from "@/workshop/library-filters.prototype";

type SortOrder = "relevance" | "title";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

const libraryMaterials: readonly MaterialPreviewFixture[] = [
  materialFixtures.platformDeliveryVideo,
  materialFixtures.publicAgentGuide,
  materialFixtures.careerVideo,
];

const filterOptions = {
  formats: unique(libraryMaterials.map((material) => material.format)),
  topics: unique(libraryMaterials.map((material) => material.topic)),
} as const;

const librarySeries = [
  ...new Map(
    libraryMaterials.flatMap((material) =>
      material.series.map((series) => [series.id, series] as const),
    ),
  ).values(),
] satisfies readonly MaterialSeriesFixture[];

const seriesFilterOptions = librarySeries.map((series) => ({
  label: series.title,
  value: series.id,
}));

function LibraryBoard() {
  const [query, setQuery] = useState("");
  const [selectedFormats, setSelectedFormats] = useState<readonly string[]>([]);
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<readonly string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>("relevance");
  const [inlineFiltersExpanded, setInlineFiltersExpanded] = useState(false);

  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const activeFilterCount =
    selectedFormats.length + selectedSeriesIds.length + selectedTopics.length;
  const selectedSeries =
    selectedSeriesIds.length === 1
      ? librarySeries.find((series) => series.id === selectedSeriesIds[0]) ?? null
      : null;
  const activeContext =
    selectedSeries?.title ?? (selectedTopics.length === 1 ? selectedTopics[0] ?? null : null);
  const relatedSeries = librarySeries.filter((series) =>
    selectedTopics.length === 0
      ? true
      : libraryMaterials.some(
          (material) =>
            selectedTopics.includes(material.topic) &&
            material.series.some((membership) => membership.id === series.id),
        ),
  );
  const filteredMaterials = libraryMaterials
    .filter((material) => {
      const searchableText = [
        material.title,
        material.summary,
        material.topic,
        material.format,
        ...material.tags,
        ...material.series.map((series) => series.title),
      ]
        .join(" ")
        .toLocaleLowerCase("ru");

      return (
        (normalizedQuery.length === 0 || searchableText.includes(normalizedQuery)) &&
        (selectedTopics.length === 0 || selectedTopics.includes(material.topic)) &&
        (selectedSeriesIds.length === 0 ||
          material.series.some((series) => selectedSeriesIds.includes(series.id))) &&
        (selectedFormats.length === 0 || selectedFormats.includes(material.format))
      );
    })
    .toSorted((first, second) =>
      sortOrder === "title" ? first.title.localeCompare(second.title, "ru") : 0,
    );

  function resetContext() {
    setSelectedSeriesIds([]);
    setSelectedTopics([]);
  }

  function resetFilters() {
    setSelectedFormats([]);
    resetContext();
  }

  function resetAll() {
    setQuery("");
    resetContext();
    resetFilters();
  }

  return (
    <ApplicationShell
      accountLabel="Кирилл"
      currentPath="/library"
      navigationItems={navigationItems}
      sidebarDefaultPinned
    >
      <div
        className="@container/library -mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent"
        data-prototype="library-responsive"
      >
        <header className="rounded-b-2xl bg-card px-5 pb-5 pt-4 sm:px-8 sm:pb-8 sm:pt-10 md:rounded-none md:bg-transparent md:p-0 @min-[52rem]/library:grid @min-[52rem]/library:grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)] @min-[52rem]/library:items-center @min-[52rem]/library:gap-4">
          <h1 className="text-2xl font-semibold leading-7 tracking-[-0.03em] @min-[30rem]/library:text-3xl @min-[30rem]/library:leading-9 @min-[52rem]/library:text-5xl @min-[52rem]/library:leading-[1.1]">
            База знаний
          </h1>
          <div className="hidden @min-[52rem]/library:block">
            <SearchControl
              inputId="library-search-desktop"
              placeholder="Название, тема, тег"
              query={query}
              setQuery={setQuery}
            />
          </div>
        </header>

        <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
          <div className="grid gap-2 pt-4 @min-[40rem]/library:grid-cols-[minmax(0,1fr)_auto] @min-[52rem]/library:hidden">
            <SearchControl
              inputId="library-search-mobile"
              placeholder="Поиск"
              query={query}
              setQuery={setQuery}
            />
            <Button
              aria-controls="library-inline-filters"
              aria-expanded={inlineFiltersExpanded}
              aria-label={
                activeFilterCount > 0
                  ? `Фильтры, выбрано ${String(activeFilterCount)}`
                  : "Фильтры"
              }
              className="min-h-11 justify-center bg-card px-3 @min-[40rem]/library:min-h-10 @min-[40rem]/library:min-w-36"
              onClick={() => {
                setInlineFiltersExpanded((current) => !current);
              }}
              variant="outline"
            >
              <SlidersHorizontal aria-hidden="true" className="size-4" />
              <span>Фильтры</span>
              {activeFilterCount > 0 ? (
                <span className="ml-auto grid size-5 place-items-center rounded-full bg-accent text-[0.6875rem] font-bold text-accent-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
          </div>

          {inlineFiltersExpanded ? (
            <div
              className="mt-3 rounded-xl bg-muted/75 p-4 @min-[52rem]/library:hidden"
              id="library-inline-filters"
            >
              <LibraryFilters
                density="compact"
                formatOptions={filterOptions.formats}
                selectedFormats={selectedFormats}
                selectedSeriesIds={selectedSeriesIds}
                selectedTopics={selectedTopics}
                seriesOptions={seriesFilterOptions}
                setSelectedFormats={setSelectedFormats}
                setSelectedSeriesIds={setSelectedSeriesIds}
                setSelectedTopics={setSelectedTopics}
                topicOptions={filterOptions.topics}
              />
            </div>
          ) : null}

          <TopicNavigation
            selectedSeriesIds={selectedSeriesIds}
            selectedTopics={selectedTopics}
            setSelectedTopic={(topic) => {
              setSelectedSeriesIds([]);
              setSelectedTopics(topic === null ? [] : [topic]);
            }}
          />

          {relatedSeries.length > 0 ? (
            <SeriesNavigation
              selectedSeriesIds={selectedSeriesIds}
              series={relatedSeries}
              setSelectedSeriesId={(seriesId) => {
                setSelectedTopics([]);
                setSelectedSeriesIds([seriesId]);
              }}
            />
          ) : null}

          <section aria-labelledby="materials-heading" className="mt-8 sm:mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.025em] @min-[30rem]/library:text-xl" id="materials-heading">
                  Материалы
                </h2>
                <div aria-live="polite" className="mt-1 font-mono text-xs text-muted-foreground" role="status">
                  {formatMaterialCount(filteredMaterials.length)}
                </div>
              </div>
              {activeContext !== null ? (
                <button
                  aria-label={`Сбросить контекст: ${activeContext}`}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-secondary px-3 text-xs font-semibold text-secondary-foreground hover:bg-muted focus-visible:outline-ring"
                  onClick={resetContext}
                  type="button"
                >
                  {activeContext}
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end @min-[52rem]/library:hidden">
              <div className="w-full max-w-48">
                <SortControl sortOrder={sortOrder} setSortOrder={setSortOrder} />
              </div>
            </div>

            <DesktopFilters
              selectedFormats={selectedFormats}
              selectedSeriesIds={selectedSeriesIds}
              selectedTopics={selectedTopics}
              setSelectedFormats={setSelectedFormats}
              setSelectedSeriesIds={setSelectedSeriesIds}
              setSelectedTopics={setSelectedTopics}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
            />

            {filteredMaterials.length > 0 ? (
              <div className="mt-4 grid items-stretch gap-4 @min-[52rem]/library:grid-cols-2 @min-[64rem]/library:grid-cols-3">
                {filteredMaterials.map((material) => (
                  <MaterialCard headingLevel="h3" key={material.id} material={material} />
                ))}
              </div>
            ) : (
              <EmptyResults onReset={resetAll} />
            )}
          </section>
        </div>
      </div>
    </ApplicationShell>
  );
}

function SearchControl({
  inputId,
  placeholder,
  query,
  setQuery,
}: {
  readonly inputId: string;
  readonly placeholder: string;
  readonly query: string;
  readonly setQuery: (query: string) => void;
}) {
  return (
    <div>
      <label className="sr-only" htmlFor={inputId}>
        Поиск по базе знаний
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          className={cn(
            "min-h-11 w-full rounded-xl border border-input bg-card pl-10 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 @min-[40rem]/library:min-h-10",
            query.length > 0 ? "pr-11" : "pr-3",
          )}
          id={inputId}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={placeholder}
          type="search"
          value={query}
        />
        {query.length > 0 ? (
          <button
            aria-label="Очистить поиск"
            className="absolute right-0 top-0 grid size-11 place-items-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-ring"
            onClick={() => {
              setQuery("");
            }}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TopicNavigation({
  selectedSeriesIds,
  selectedTopics,
  setSelectedTopic,
}: {
  readonly selectedSeriesIds: readonly string[];
  readonly selectedTopics: readonly string[];
  readonly setSelectedTopic: (topic: string | null) => void;
}) {
  const allTopicsSelected = selectedTopics.length === 0 && selectedSeriesIds.length === 0;

  return (
    <section aria-labelledby="topics-heading" className="mt-8 sm:mt-10">
      <h2 className="text-lg font-semibold tracking-[-0.025em] @min-[30rem]/library:text-xl" id="topics-heading">
        Темы
      </h2>
      <div
        className="library-topic-rail mt-3 grid snap-x snap-mandatory auto-cols-[calc((100%_-_0.75rem)_/_2)] grid-flow-col gap-3 overflow-x-auto pb-1 overscroll-x-contain touch-pan-x sm:grid-flow-row sm:grid-cols-4 sm:overflow-visible @min-[52rem]/library:pb-0"
        data-topic-navigation
      >
        <TopicButton
          count={libraryMaterials.length}
          label="Все темы"
          onClick={() => {
            setSelectedTopic(null);
          }}
          selected={allTopicsSelected}
        />
        {filterOptions.topics.map((topic) => (
          <TopicButton
            count={libraryMaterials.filter((material) => material.topic === topic).length}
            key={topic}
            label={topic}
            onClick={() => {
              setSelectedTopic(topic);
            }}
            selected={selectedTopics.includes(topic)}
          />
        ))}
      </div>
    </section>
  );
}

function TopicButton({
  count,
  label,
  onClick,
  selected,
}: {
  readonly count: number;
  readonly label: string;
  readonly onClick: () => void;
  readonly selected: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "relative grid min-h-24 min-w-0 snap-start content-between rounded-xl p-3 text-left transition-colors focus-visible:outline-ring sm:min-h-28 sm:p-4",
        selected
          ? "bg-primary text-primary-foreground shadow-card"
          : "border border-border bg-muted/60 text-foreground hover:bg-muted",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="pr-6">
        <span className="text-sm font-semibold leading-5 tracking-[-0.02em] sm:text-base">{label}</span>
        <ArrowUpRight
          aria-hidden="true"
          className={cn(
            "absolute right-3 top-3 size-4 sm:right-4 sm:top-4",
            selected ? "text-accent" : "text-muted-foreground",
          )}
        />
      </span>
      <span
        className={cn(
          "font-mono text-[0.6875rem]",
          selected ? "text-primary-foreground/65" : "text-muted-foreground",
        )}
      >
        {formatMaterialCount(count)}
      </span>
    </button>
  );
}

function SeriesNavigation({
  selectedSeriesIds,
  series,
  setSelectedSeriesId,
}: {
  readonly selectedSeriesIds: readonly string[];
  readonly series: readonly MaterialSeriesFixture[];
  readonly setSelectedSeriesId: (seriesId: string) => void;
}) {
  return (
    <section aria-labelledby="playlists-heading" className="mt-6 sm:mt-7">
      <h2 className="text-lg font-semibold tracking-[-0.025em] @min-[30rem]/library:text-xl" id="playlists-heading">
        Плейлисты
      </h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {series.map((item) => {
          const selected = selectedSeriesIds.includes(item.id);
          const materialCount = libraryMaterials.filter((material) =>
            material.series.some((membership) => membership.id === item.id),
          ).length;

          return (
            <button
              aria-label={`${item.title}, ${formatMaterialCount(materialCount)}`}
              aria-pressed={selected}
              className={cn(
                "group flex min-h-20 items-center justify-between gap-4 rounded-xl bg-sidebar p-4 text-left text-sidebar-foreground shadow-card transition-[box-shadow,transform] focus-visible:outline-sidebar-ring motion-reduce:transform-none motion-reduce:transition-none sm:min-h-24",
                "hover:-translate-y-0.5 hover:shadow-card-hover",
                selected && "outline-2 outline-offset-2 outline-sidebar-ring",
              )}
              key={item.id}
              onClick={() => {
                setSelectedSeriesId(item.id);
              }}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sidebar-accent text-sidebar-primary">
                  <ListVideo aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-5 tracking-[-0.02em] sm:text-base">
                    {item.title}
                  </span>
                  <span className="mt-1 block font-mono text-[0.6875rem] text-sidebar-foreground/58">
                    {formatMaterialCount(materialCount)}
                  </span>
                </span>
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="size-5 shrink-0 text-sidebar-primary transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface FilterProps {
  readonly selectedFormats: readonly string[];
  readonly selectedSeriesIds: readonly string[];
  readonly selectedTopics: readonly string[];
  readonly setSelectedFormats: (values: readonly string[]) => void;
  readonly setSelectedSeriesIds: (values: readonly string[]) => void;
  readonly setSelectedTopics: (values: readonly string[]) => void;
}

function DesktopFilters({
  selectedFormats,
  selectedSeriesIds,
  selectedTopics,
  setSelectedFormats,
  setSelectedSeriesIds,
  setSelectedTopics,
  setSortOrder,
  sortOrder,
}: FilterProps & {
  readonly setSortOrder: (sortOrder: SortOrder) => void;
  readonly sortOrder: SortOrder;
}) {
  return (
    <div className="mt-5 hidden grid-cols-[minmax(0,1fr)_12rem] items-start gap-6 rounded-xl bg-muted/75 p-4 @min-[52rem]/library:grid">
      <LibraryFilters
        density="compact"
        formatOptions={filterOptions.formats}
        selectedFormats={selectedFormats}
        selectedSeriesIds={selectedSeriesIds}
        selectedTopics={selectedTopics}
        seriesOptions={seriesFilterOptions}
        setSelectedFormats={setSelectedFormats}
        setSelectedSeriesIds={setSelectedSeriesIds}
        setSelectedTopics={setSelectedTopics}
        topicOptions={filterOptions.topics}
      />
      <SortControl sortOrder={sortOrder} setSortOrder={setSortOrder} />
    </div>
  );
}

function SortControl({
  setSortOrder,
  sortOrder,
}: {
  readonly setSortOrder: (sortOrder: SortOrder) => void;
  readonly sortOrder: SortOrder;
}) {
  return (
    <div className="min-w-0">
      <span className="sr-only" id="library-sort-label">
        Сортировка
      </span>
      <Select
        onValueChange={(value) => {
          setSortOrder(value as SortOrder);
        }}
        value={sortOrder}
      >
        <SelectTrigger aria-labelledby="library-sort-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="relevance">По умолчанию</SelectItem>
          <SelectItem value="title">По названию</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyResults({ onReset }: { readonly onReset: () => void }) {
  return (
    <div
      aria-labelledby="empty-library-heading"
      className="mt-4 rounded-xl bg-muted px-4 py-7 text-center"
    >
      <h3 className="text-base font-semibold" id="empty-library-heading">
        Ничего не найдено
      </h3>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">
        Измените запрос или сбросьте контекст и фильтры.
      </p>
      <Button className="mt-5 min-h-11 px-4" onClick={onReset} variant="outline">
        Показать все материалы
      </Button>
    </div>
  );
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function formatMaterialCount(count: number): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${String(count)} материалов`;
  }

  if (lastDigit === 1) {
    return `${String(count)} материал`;
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${String(count)} материала`;
  }

  return `${String(count)} материалов`;
}

const meta = {
  component: LibraryBoard,
  parameters: {
    docs: {
      description: {
        component:
          "Owner-controlled responsive Library proof. Topic, Format and Series are canonical multi-select facets; Tags remain visible links and searchable text across the approved F1–F3 fixtures.",
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  title: "Pages/Library",
} satisfies Meta<typeof LibraryBoard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  name: "Mobile discovery flow",
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile320",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const topicButtons = Array.from(
      canvasElement.querySelectorAll<HTMLButtonElement>("[data-topic-navigation] button"),
    );

    await expect(canvas.getByRole("heading", { name: "База знаний" })).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);
    await expect(canvas.getByRole("button", { name: "Все темы" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      topicButtons.every((button) => {
        const buttonBounds = button.getBoundingClientRect();
        const arrowBounds = button.querySelector("svg")?.getBoundingClientRect();

        return (
          arrowBounds !== undefined &&
          arrowBounds.left >= buttonBounds.left &&
          arrowBounds.right <= buttonBounds.right
        );
      }),
    ).toBe(true);

    await userEvent.click(canvas.getByRole("button", { name: "Product engineering" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await expect(
      canvas.getByRole("button", { name: "Создание Platform Inside, 1 материал" }),
    ).toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Создание Platform Inside, 1 материал" }),
    );
    await expect(canvas.getByRole("button", { name: "Product engineering" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      canvas.getByRole("button", { name: "Создание Platform Inside, 1 материал" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      canvas.getByRole("button", { name: "Сбросить контекст: Создание Platform Inside" }),
    );
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);

    const searchInput = canvas.getByRole("searchbox", { name: "Поиск по базе знаний" });
    await userEvent.type(searchInput, "несуществующий материал");
    await expect(canvas.getByRole("heading", { name: "Ничего не найдено" })).toBeInTheDocument();
    await userEvent.clear(searchInput);

    const filterTrigger = canvas.getByRole("button", { name: "Фильтры" });
    await userEvent.click(filterTrigger);
    await expect(filterTrigger).toHaveAttribute("aria-expanded", "true");
    const inlineFilters = canvas.getByRole("region", { name: "Фильтры базы знаний" });
    await userEvent.click(within(inlineFilters).getByRole("checkbox", { name: "Видео" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(2);

    await waitFor(async () => {
      await expect(
        canvas.getByRole("button", { name: "Фильтры, выбрано 1" }),
      ).toBeInTheDocument();
    });
    await userEvent.click(within(inlineFilters).getByRole("checkbox", { name: "Видео" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);
    await userEvent.click(canvas.getByRole("button", { name: "Фильтры" }));
    await expect(canvas.queryByRole("region", { name: "Фильтры базы знаний" })).not.toBeInTheDocument();
    await waitFor(async () => {
      await expect(canvas.getByRole("heading", { name: "База знаний" })).toBeInTheDocument();
    });
    (canvasElement.ownerDocument.activeElement as HTMLElement | null)?.blur();
    canvasElement.ownerDocument.defaultView?.scrollTo({ left: 0, top: 0 });
  },
};

export const NarrowDesktop: Story = {
  name: "Narrow desktop · inline filters",
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1036",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("heading", { name: "База знаний" });
    const searchInput = canvas.getByRole("searchbox", { name: "Поиск по базе знаний" });
    const filterTrigger = canvas.getByRole("button", { name: "Фильтры" });

    await expect(searchInput.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      heading.getBoundingClientRect().bottom,
    );
    await expect(
      Math.abs(searchInput.getBoundingClientRect().top - filterTrigger.getBoundingClientRect().top),
    ).toBeLessThanOrEqual(1);

    await userEvent.click(filterTrigger);
    await expect(filterTrigger).toHaveAttribute("aria-expanded", "true");
    const filters = canvas.getByRole("region", { name: "Фильтры базы знаний" });

    await expect(filters).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog", { name: "Фильтры" })).not.toBeInTheDocument();
    await expect(within(filters).getByRole("group", { name: "Тема" })).toBeInTheDocument();
    await expect(within(filters).getByRole("group", { name: "Формат" })).toBeInTheDocument();
    await expect(within(filters).getByRole("group", { name: "Плейлисты" })).toBeInTheDocument();
    await expect(within(filters).queryByRole("group", { name: "Теги" })).not.toBeInTheDocument();
  },
};

export const Desktop: Story = {
  name: "Desktop discovery flow",
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1440",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyBody = within(canvasElement.ownerDocument.body);
    const materialCards = Array.from(canvasElement.querySelectorAll<HTMLElement>("article"));
    const platformVideo = canvasElement.querySelector<HTMLElement>(
      `[data-material-id="${materialFixtures.platformDeliveryVideo.id}"]`,
    );
    const careerVideo = canvasElement.querySelector<HTMLElement>(
      `[data-material-id="${materialFixtures.careerVideo.id}"]`,
    );
    const publicGuide = canvasElement.querySelector<HTMLElement>(
      `[data-material-id="${materialFixtures.publicAgentGuide.id}"]`,
    );

    await expect(materialCards).toHaveLength(3);
    await expect(
      materialCards.every((card) => card.getBoundingClientRect().width < 400),
    ).toBe(true);
    if (platformVideo === null || careerVideo === null || publicGuide === null) {
      throw new Error("Material cards are missing");
    }

    await expect(
      Math.abs(
        platformVideo.getBoundingClientRect().height -
          careerVideo.getBoundingClientRect().height,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(
      Math.abs(
        publicGuide.getBoundingClientRect().height -
          platformVideo.getBoundingClientRect().height,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(
      platformVideo.getBoundingClientRect().height /
        platformVideo.getBoundingClientRect().width,
    ).toBeLessThan(1.5);
    await userEvent.click(canvas.getByRole("button", { name: "AI-first engineering" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await expect(
      canvas.queryByRole("heading", { name: "Плейлисты" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Сбросить контекст: AI-first engineering" }),
    );

    await userEvent.click(canvas.getByRole("checkbox", { name: "AI-first engineering" }));
    await userEvent.click(canvas.getByRole("checkbox", { name: "Карьера" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(2);
    await userEvent.click(canvas.getByRole("checkbox", { name: "Видео" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await expect(canvas.getByRole("heading", { name: materialFixtures.careerVideo.title })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("checkbox", { name: "Видео" }));
    await userEvent.click(canvas.getByRole("checkbox", { name: "AI-first engineering" }));
    await userEvent.click(canvas.getByRole("checkbox", { name: "Карьера" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);

    await userEvent.click(canvas.getByRole("checkbox", { name: "Создание Platform Inside" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    const filteredPlatformVideo = canvasElement.querySelector<HTMLElement>(
      `[data-material-id="${materialFixtures.platformDeliveryVideo.id}"]`,
    );
    if (filteredPlatformVideo === null) {
      throw new Error("Filtered Material card is missing");
    }
    await expect(filteredPlatformVideo).toHaveTextContent(
      /Создание Platform Inside.*№ 5/u,
    );
    await userEvent.click(canvas.getByRole("checkbox", { name: "Создание Platform Inside" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);

    await expect(canvas.getAllByText("harness").length).toBeGreaterThan(0);

    const sortControl = canvas.getByRole("combobox", { name: "Сортировка" });
    await userEvent.click(sortControl);
    await userEvent.click(storyBody.getByRole("option", { name: "По названию" }));
    await expect(sortControl).toHaveTextContent("По названию");
    await waitFor(async () => {
      await expect(sortControl).toHaveAttribute("aria-expanded", "false");
      await expect(
        canvasElement.ownerDocument.querySelector('[role="listbox"]'),
      ).not.toBeInTheDocument();
    });
    (canvasElement.ownerDocument.activeElement as HTMLElement | null)?.blur();
    canvasElement.ownerDocument.defaultView?.scrollTo({ left: 0, top: 0 });
  },
};
