"use client";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  ArrowUpRight,
  Check,
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
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

type SortOrder = "relevance" | "title";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

const libraryMaterials: readonly MaterialPreviewFixture[] = [
  materialFixtures.platformDeliveryVideo,
  materialFixtures.publicAgentGuide,
  materialFixtures.careerVideo,
];

const filterOptions = {
  formats: unique(libraryMaterials.map((material) => material.format)),
  tags: unique(libraryMaterials.flatMap((material) => material.tags)),
  topics: unique(libraryMaterials.map((material) => material.topic)),
} as const;

const librarySeries = [
  ...new Map(
    libraryMaterials.flatMap((material) =>
      material.series.map((series) => [series.id, series] as const),
    ),
  ).values(),
] satisfies readonly MaterialSeriesFixture[];

function LibraryBoard() {
  const [query, setQuery] = useState("");
  const [selectedFormats, setSelectedFormats] = useState<readonly string[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("relevance");

  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const activeFilterCount = selectedFormats.length + selectedTags.length;
  const selectedSeries = librarySeries.find((series) => series.id === selectedSeriesId) ?? null;
  const activeContext = selectedSeries?.title ?? selectedTopic;
  const relatedSeries = librarySeries.filter((series) =>
    selectedTopic === null
      ? true
      : libraryMaterials.some(
          (material) =>
            material.topic === selectedTopic &&
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
        (selectedTopic === null || material.topic === selectedTopic) &&
        (selectedSeriesId === null ||
          material.series.some((series) => series.id === selectedSeriesId)) &&
        (selectedFormats.length === 0 || selectedFormats.includes(material.format)) &&
        (selectedTags.length === 0 || material.tags.some((tag) => selectedTags.includes(tag)))
      );
    })
    .toSorted((first, second) =>
      sortOrder === "title" ? first.title.localeCompare(second.title, "ru") : 0,
    );

  function resetContext() {
    setSelectedSeriesId(null);
    setSelectedTopic(null);
  }

  function resetFilters() {
    setSelectedFormats([]);
    setSelectedTags([]);
  }

  function resetAll() {
    setQuery("");
    resetContext();
    resetFilters();
  }

  return (
    <ApplicationShell
      accountAvatarUrl="https://github.com/KirillSachkov.png?size=80"
      accountLabel="Кирилл"
      currentPath="/library"
      layout="sidebar"
      navigationItems={navigationItems}
      sidebarDefaultPinned
    >
      <div
        className="-mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent"
        data-prototype="library-responsive"
      >
        <header className="rounded-b-2xl bg-card px-5 pb-5 pt-4 sm:px-8 sm:pb-8 sm:pt-10 md:rounded-none md:bg-transparent md:p-0 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)] lg:items-center lg:gap-4">
          <h1 className="text-2xl font-semibold leading-7 tracking-[-0.03em] sm:text-4xl sm:leading-10 lg:text-5xl lg:leading-[1.1]">
            Библиотека
          </h1>
          <div className="hidden lg:block">
            <SearchControl
              inputId="library-search-desktop"
              placeholder="Название, тема, тег"
              query={query}
              setQuery={setQuery}
            />
          </div>
        </header>

        <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
          <div className="grid gap-2 pt-4 lg:hidden">
            <SearchControl
              inputId="library-search-mobile"
              placeholder="Поиск"
              query={query}
              setQuery={setQuery}
            />
            <FilterSheet
              activeFilterCount={activeFilterCount}
              onReset={resetFilters}
              resultCount={filteredMaterials.length}
              selectedFormats={selectedFormats}
              selectedTags={selectedTags}
              setSelectedFormats={setSelectedFormats}
              setSelectedTags={setSelectedTags}
            />
          </div>

          <TopicNavigation
            selectedSeriesId={selectedSeriesId}
            selectedTopic={selectedTopic}
            setSelectedTopic={(topic) => {
              setSelectedSeriesId(null);
              setSelectedTopic(topic);
            }}
          />

          {relatedSeries.length > 0 ? (
            <SeriesNavigation
              selectedSeriesId={selectedSeriesId}
              series={relatedSeries}
              setSelectedSeriesId={(seriesId) => {
                setSelectedTopic(null);
                setSelectedSeriesId(seriesId);
              }}
            />
          ) : null}

          <section aria-labelledby="materials-heading" className="mt-8 sm:mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2
                  className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl"
                  id="materials-heading"
                >
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

            <div className="mt-4 flex justify-end lg:hidden">
              <div className="w-full max-w-48">
                <SortControl sortOrder={sortOrder} setSortOrder={setSortOrder} />
              </div>
            </div>

            <DesktopFilters
              selectedFormats={selectedFormats}
              selectedTags={selectedTags}
              setSelectedFormats={setSelectedFormats}
              setSelectedTags={setSelectedTags}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
            />

            {filteredMaterials.length > 0 ? (
              <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
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
        Поиск по библиотеке
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          className={cn(
            "min-h-11 w-full rounded-xl border border-input bg-card pl-10 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
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
  selectedSeriesId,
  selectedTopic,
  setSelectedTopic,
}: {
  readonly selectedSeriesId: string | null;
  readonly selectedTopic: string | null;
  readonly setSelectedTopic: (topic: string | null) => void;
}) {
  const allTopicsSelected = selectedTopic === null && selectedSeriesId === null;

  return (
    <section aria-labelledby="topics-heading" className="mt-8 sm:mt-10">
      <h2 className="text-lg font-semibold tracking-[-0.025em] sm:text-xl" id="topics-heading">
        Темы
      </h2>
      <div
        className="library-topic-rail mt-3 grid snap-x snap-mandatory auto-cols-[calc((100%_-_0.75rem)_/_2)] grid-flow-col gap-3 overflow-x-auto pb-1 overscroll-x-contain touch-pan-x sm:grid-flow-row sm:grid-cols-4 sm:overflow-visible lg:pb-0"
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
            selected={selectedTopic === topic}
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
        "grid min-h-24 min-w-0 snap-start content-between rounded-xl p-3 text-left transition-colors focus-visible:outline-ring sm:min-h-28 sm:p-4",
        selected
          ? "bg-primary text-primary-foreground shadow-card"
          : "border border-border bg-muted/60 text-foreground hover:bg-muted",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-start justify-between gap-4">
        <span className="text-sm font-semibold leading-5 tracking-[-0.02em] sm:text-base">{label}</span>
        <ArrowUpRight
          aria-hidden="true"
          className={cn("size-4 shrink-0", selected ? "text-accent" : "text-muted-foreground")}
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
  selectedSeriesId,
  series,
  setSelectedSeriesId,
}: {
  readonly selectedSeriesId: string | null;
  readonly series: readonly MaterialSeriesFixture[];
  readonly setSelectedSeriesId: (seriesId: string) => void;
}) {
  return (
    <section aria-labelledby="playlists-heading" className="mt-6 sm:mt-7">
      <h2 className="text-lg font-semibold tracking-[-0.025em] sm:text-xl" id="playlists-heading">
        Плейлисты
      </h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {series.map((item) => {
          const selected = selectedSeriesId === item.id;
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
  readonly selectedTags: readonly string[];
  readonly setSelectedFormats: (values: readonly string[]) => void;
  readonly setSelectedTags: (values: readonly string[]) => void;
}

function DesktopFilters({
  selectedFormats,
  selectedTags,
  setSelectedFormats,
  setSelectedTags,
  setSortOrder,
  sortOrder,
}: FilterProps & {
  readonly setSortOrder: (sortOrder: SortOrder) => void;
  readonly sortOrder: SortOrder;
}) {
  return (
    <div className="mt-5 hidden grid-cols-[minmax(10rem,0.55fr)_minmax(0,1.45fr)_12rem] items-start gap-6 rounded-xl bg-muted/55 p-4 lg:grid">
      <FilterGroup
        compact
        label="Формат"
        options={filterOptions.formats}
        selected={selectedFormats}
        setSelected={setSelectedFormats}
      />
      <FilterGroup
        compact
        label="Тег"
        options={filterOptions.tags}
        selected={selectedTags}
        setSelected={setSelectedTags}
      />
      <SortControl sortOrder={sortOrder} setSortOrder={setSortOrder} />
    </div>
  );
}

function FilterSheet({
  activeFilterCount,
  onReset,
  resultCount,
  selectedFormats,
  selectedTags,
  setSelectedFormats,
  setSelectedTags,
}: FilterProps & {
  readonly activeFilterCount: number;
  readonly onReset: () => void;
  readonly resultCount: number;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          aria-label={
            activeFilterCount > 0
              ? `Фильтры, выбрано ${String(activeFilterCount)}`
              : "Фильтры"
          }
          className="min-h-11 w-full justify-center bg-card px-3"
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
      </SheetTrigger>
      <SheetContent
        className="max-h-[min(88svh,40rem)] gap-0 overflow-hidden rounded-t-3xl border-border"
        showCloseButton={false}
        side="bottom"
      >
        <SheetHeader className="relative border-b border-border px-5 pb-4 pt-5">
          <SheetTitle className="text-lg font-semibold tracking-[-0.02em]">Фильтры</SheetTitle>
          <SheetDescription>Форматы и теги из текущей Library fixture.</SheetDescription>
          <SheetClose asChild>
            <Button
              aria-label="Закрыть фильтры"
              className="absolute right-3 top-3 size-11"
              size="icon"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="overflow-y-auto px-5 py-4 overscroll-contain">
          <FilterGroup
            label="Формат"
            options={filterOptions.formats}
            selected={selectedFormats}
            setSelected={setSelectedFormats}
          />
          <FilterGroup
            label="Тег"
            options={filterOptions.tags}
            selected={selectedTags}
            setSelected={setSelectedTags}
          />
        </div>
        <SheetFooter className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <Button
            className="min-h-11 px-4"
            disabled={activeFilterCount === 0}
            onClick={onReset}
            variant="ghost"
          >
            Сбросить
          </Button>
          <SheetClose asChild>
            <Button className="min-h-11 px-4">
              Показать {formatMaterialCount(resultCount)}
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterGroup({
  compact = false,
  label,
  options,
  selected,
  setSelected,
}: {
  readonly compact?: boolean;
  readonly label: string;
  readonly options: readonly string[];
  readonly selected: readonly string[];
  readonly setSelected: (values: readonly string[]) => void;
}) {
  return (
    <fieldset className={cn("border-0 p-0", compact ? "min-w-0" : "not-last:mb-5")}>
      <legend className="mb-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </legend>
      <div className={cn(compact ? "flex flex-wrap gap-1.5" : "grid gap-2")}>
        {options.map((option) => {
          const checked = selected.includes(option);

          return (
            <label
              className={cn(
                "cursor-pointer font-medium",
                "has-focus-visible:outline-3 has-focus-visible:outline-ring has-focus-visible:outline-offset-2",
                compact
                  ? "inline-flex min-h-9 items-center rounded-lg px-3 text-xs"
                  : "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
                checked ? "bg-secondary text-foreground" : "bg-background text-muted-foreground",
              )}
              key={option}
            >
              <input
                checked={checked}
                className="peer sr-only"
                onChange={() => {
                  setSelected(toggleValue(selected, option));
                }}
                type="checkbox"
              />
              {compact ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-md border",
                    checked
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-input bg-background",
                  )}
                >
                  {checked ? <Check className="size-3.5" /> : null}
                </span>
              )}
              <span className="min-w-0 break-words">{option}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
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

function toggleValue(values: readonly string[], value: string): readonly string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
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
          "Owner-controlled responsive Library proof. Topic is primary browse navigation, Playlist is an ordered context, and Format/Tag refine the resulting approved F1–F3 fixtures.",
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
    const storyBody = within(canvasElement.ownerDocument.body);

    await expect(canvas.getByRole("heading", { name: "Библиотека" })).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);
    await expect(canvas.getByRole("button", { name: "Все темы" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

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

    const searchInput = canvas.getByRole("searchbox", { name: "Поиск по библиотеке" });
    await userEvent.type(searchInput, "несуществующий материал");
    await expect(canvas.getByRole("heading", { name: "Ничего не найдено" })).toBeInTheDocument();
    await userEvent.clear(searchInput);

    await userEvent.click(canvas.getByRole("button", { name: "Фильтры" }));
    const filtersDialog = storyBody.getByRole("dialog", { name: "Фильтры" });
    await userEvent.click(within(filtersDialog).getByRole("checkbox", { name: "Видео" }));
    await userEvent.click(
      within(filtersDialog).getByRole("button", { name: "Показать 2 материала" }),
    );
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(2);

    await waitFor(async () => {
      await expect(
        canvas.getByRole("button", { name: "Фильтры, выбрано 1" }),
      ).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByRole("button", { name: "Фильтры, выбрано 1" }));
    const reopenedFiltersDialog = storyBody.getByRole("dialog", { name: "Фильтры" });
    await userEvent.click(within(reopenedFiltersDialog).getByRole("button", { name: "Сбросить" }));
    await userEvent.click(
      within(reopenedFiltersDialog).getByRole("button", { name: "Показать 3 материала" }),
    );
    await waitFor(async () => {
      await expect(canvas.getByRole("heading", { name: "Библиотека" })).toBeInTheDocument();
    });
    (canvasElement.ownerDocument.activeElement as HTMLElement | null)?.blur();
    canvasElement.ownerDocument.defaultView?.scrollTo({ left: 0, top: 0 });
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

    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);
    await userEvent.click(canvas.getByRole("button", { name: "AI-first engineering" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await expect(
      canvas.queryByRole("heading", { name: "Плейлисты" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Сбросить контекст: AI-first engineering" }),
    );

    await userEvent.click(canvas.getByRole("checkbox", { name: "Гайд" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("checkbox", { name: "Гайд" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);

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
