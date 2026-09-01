"use client";

import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  ListVideo,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import {
  MaterialCard,
  materialFixtures,
  type MaterialPreviewFixture,
} from "@/workshop/material-preview.prototype";
import { LibraryFilters } from "@/workshop/library-filters.prototype";

/**
 * PROTOTYPE #197. Three compositions answer one question: how should large Topic and Playlist
 * cards lead into the existing catalog without moving search or filters into a sidebar?
 */

export type KnowledgeBaseVariant = "featured" | "equal" | "playlist-first";
export type KnowledgeBaseScenario = "empty" | "populated" | "sparse";

export interface KnowledgeBasePrototypeProps {
  readonly initialVariant?: KnowledgeBaseVariant;
  readonly scenario?: KnowledgeBaseScenario;
}

interface TopicFixture {
  readonly count: number;
  readonly description: string;
  readonly diagram: readonly [string, string, string];
  readonly slug: string;
  readonly title: string;
  readonly visual: "ai" | "career" | "product";
}

interface PlaylistFixture {
  readonly count: number;
  readonly description: string;
  readonly slug: string;
  readonly title: string;
}

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

const topics = [
  {
    count: 12,
    description: "Продукт, архитектура и проверяемый delivery.",
    diagram: ["Задача", "Проверка", "Решение"],
    slug: "product-engineering",
    title: "Product engineering",
    visual: "product",
  },
  {
    count: 9,
    description: "Агенты, harness и новые рабочие процессы.",
    diagram: ["Правила", "Навык", "Результат"],
    slug: "ai-first-engineering",
    title: "AI-first engineering",
    visual: "ai",
  },
  {
    count: 7,
    description: "Поиск работы, рост и профессиональный выбор.",
    diagram: ["Гипотеза", "Шаг", "Выбор"],
    slug: "career",
    title: "Карьера",
    visual: "career",
  },
] as const satisfies readonly TopicFixture[];

const playlists = [
  {
    count: 6,
    description: "От первого product brief до работающего delivery-контура.",
    slug: "platform-inside",
    title: "Создание Platform Inside",
  },
] as const satisfies readonly PlaylistFixture[];

const materials = [
  materialFixtures.platformDeliveryVideo,
  materialFixtures.publicAgentGuide,
  materialFixtures.careerVideo,
] as const satisfies readonly MaterialPreviewFixture[];

const variants = [
  { key: "featured", label: "A · Главная тема" },
  { key: "equal", label: "B · Равные карточки" },
  { key: "playlist-first", label: "C · Сначала плейлист" },
] as const satisfies readonly {
  readonly key: KnowledgeBaseVariant;
  readonly label: string;
}[];

export function KnowledgeBasePrototype({
  initialVariant = "featured",
  scenario = "populated",
}: KnowledgeBasePrototypeProps) {
  const [variant, setVariant] = useState<KnowledgeBaseVariant>(initialVariant);
  const scenarioData = getScenarioData(scenario);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']") !== null
      ) {
        return;
      }

      event.preventDefault();
      setVariant((current) => adjacentVariant(current, event.key === "ArrowRight" ? 1 : -1));
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.removeEventListener("keydown", handleKeyboard);
    };
  }, []);

  function chooseVariant(next: KnowledgeBaseVariant) {
    setVariant(next);
  }

  return (
    <ApplicationShell
      accountLabel="Кирилл"
      currentPath="/library"
      navigationItems={navigationItems}
      sidebarDefaultPinned
    >
      <div
        className="@container/knowledge -mx-5 -mb-7 overflow-clip bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent"
        data-prototype="knowledge-base-responsive"
        data-prototype-scenario={scenario}
        data-prototype-variant={variant}
      >
        <KnowledgeBaseHeader />
        <PrototypeSwitcher chooseVariant={chooseVariant} variant={variant} />
        <div className="px-5 pb-24 sm:px-8 sm:pb-28 md:px-0 md:pb-24">
          {variant === "featured" ? (
            <FeaturedTopicsVariant {...scenarioData} />
          ) : variant === "equal" ? (
            <EqualTopicsVariant {...scenarioData} />
          ) : (
            <PlaylistFirstVariant {...scenarioData} />
          )}
        </div>
      </div>
    </ApplicationShell>
  );
}

function KnowledgeBaseHeader() {
  return (
    <header className="rounded-b-2xl bg-card px-5 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-10 md:rounded-none md:bg-transparent md:p-0">
      <h1 className="max-w-[12ch] text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-4xl @min-[60rem]/knowledge:text-5xl">
        База знаний
      </h1>
      <p className="mt-3 max-w-[58ch] text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
        Начните с темы или плейлиста — либо откройте полный каталог материалов.
      </p>
    </header>
  );
}

function FeaturedTopicsVariant({
  materials: availableMaterials,
  playlists: availablePlaylists,
  topics: availableTopics,
}: ScenarioData) {
  return (
    <>
      <DiscoverySectionHeader
        className="mt-8 sm:mt-10"
        description="Крупная тема задаёт вход, остальные остаются рядом."
        title="Темы"
      />
      {availableTopics.length > 0 ? (
        <div className="mt-4 grid gap-4 @min-[46rem]/knowledge:grid-cols-2">
          {availableTopics.map((topic, index) => (
            <TopicLinkCard featured={index === 0} key={topic.slug} topic={topic} />
          ))}
        </div>
      ) : (
        <DiscoveryEmpty kind="topics" />
      )}

      <DiscoverySectionHeader
        className="mt-10 sm:mt-12"
        description="Материалы в порядке, который задал автор."
        title="Плейлисты"
      />
      {availablePlaylists.length > 0 ? (
        <div className="mt-4 grid gap-4 @min-[48rem]/knowledge:grid-cols-2">
          {availablePlaylists.map((playlist) => (
            <PlaylistCard key={playlist.slug} playlist={playlist} />
          ))}
        </div>
      ) : (
        <DiscoveryEmpty kind="playlists" />
      )}

      <CatalogSection materials={availableMaterials} />
    </>
  );
}

function EqualTopicsVariant({
  materials: availableMaterials,
  playlists: availablePlaylists,
  topics: availableTopics,
}: ScenarioData) {
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const activeTopic =
    availableTopics.find((topic) => topic.slug === selectedTopic) ?? null;
  const visibleMaterials =
    activeTopic === null
      ? availableMaterials
      : availableMaterials.filter((material) => material.topic === activeTopic.title);

  return (
    <>
      <DiscoverySectionHeader
        className="mt-8 sm:mt-10"
        description="Все направления равноправны; выбор сразу уточняет каталог."
        title="Темы"
      />
      {availableTopics.length > 0 ? (
        <div className="mt-4 grid gap-4 @min-[42rem]/knowledge:grid-cols-2 @min-[64rem]/knowledge:grid-cols-3">
          {availableTopics.map((topic) => (
            <TopicFilterCard
              key={topic.slug}
              onSelect={() => {
                setSelectedTopic((current) => (current === topic.slug ? null : topic.slug));
              }}
              selected={selectedTopic === topic.slug}
              topic={topic}
            />
          ))}
        </div>
      ) : (
        <DiscoveryEmpty kind="topics" />
      )}

      <DiscoverySectionHeader
        className="mt-10 sm:mt-12"
        description="Материалы в порядке, который задал автор."
        title="Плейлисты"
      />
      {availablePlaylists.length > 0 ? (
        <section aria-label="Плейлисты">
          <div className="mt-4 grid gap-4 @min-[48rem]/knowledge:grid-cols-2">
            {availablePlaylists.map((playlist) => (
              <PlaylistCard key={playlist.slug} playlist={playlist} />
            ))}
          </div>
        </section>
      ) : (
        <DiscoveryEmpty kind="playlists" />
      )}

      <CatalogSection
        activeContext={activeTopic?.title ?? null}
        materials={visibleMaterials}
        onResetContext={() => {
          setSelectedTopic(null);
        }}
      />
    </>
  );
}

function PlaylistFirstVariant({
  materials: availableMaterials,
  playlists: availablePlaylists,
  topics: availableTopics,
}: ScenarioData) {
  return (
    <>
      <DiscoverySectionHeader
        className="mt-8 sm:mt-10"
        description="Готовый маршрут получает первый приоритет на странице."
        title="Плейлисты"
      />
      {availablePlaylists.length > 0 ? (
        <div className="mt-4">
          {availablePlaylists.map((playlist) => (
            <FeaturedPlaylistCard key={playlist.slug} playlist={playlist} />
          ))}
        </div>
      ) : (
        <DiscoveryEmpty kind="playlists" />
      )}

      <DiscoverySectionHeader
        className="mt-10 sm:mt-12"
        description="Самостоятельные направления для свободного изучения."
        title="Темы"
      />
      {availableTopics.length > 0 ? (
        <div className="mt-4 grid gap-4 @min-[52rem]/knowledge:grid-cols-3">
          {availableTopics.map((topic) => (
            <HorizontalTopicCard key={topic.slug} topic={topic} />
          ))}
        </div>
      ) : (
        <DiscoveryEmpty kind="topics" />
      )}

      <CatalogSection materials={availableMaterials} />
    </>
  );
}

function DiscoverySectionHeader({
  className,
  description,
  title,
}: {
  readonly className?: string;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-2", className)}>
      <h2 className="text-xl font-semibold tracking-[-0.025em] sm:text-2xl">{title}</h2>
      <p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function TopicLinkCard({
  featured,
  topic,
}: {
  readonly featured: boolean;
  readonly topic: TopicFixture;
}) {
  return (
    <a
      className={cn(
        "group/topic relative isolate min-h-64 overflow-clip rounded-2xl bg-sidebar text-sidebar-foreground no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-sidebar-ring motion-reduce:transform-none motion-reduce:transition-none",
        featured && "@min-[46rem]/knowledge:col-span-2 @min-[46rem]/knowledge:min-h-80",
      )}
      href={`/topics/${topic.slug}`}
    >
      <TopicArtwork featured={featured} topic={topic} />
      <span className="absolute inset-x-0 bottom-0 z-10 bg-sidebar/95 p-5 sm:p-6">
        <span className="flex items-start justify-between gap-4">
          <span>
            <span
              className={cn(
                "block max-w-[24ch] text-xl font-semibold leading-[1.18] tracking-[-0.03em]",
                featured && "sm:text-3xl",
              )}
            >
              {topic.title}
            </span>
            <span className="mt-2 block max-w-[50ch] text-sm leading-5 text-sidebar-foreground/70">
              {topic.description}
            </span>
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="size-5 shrink-0 text-sidebar-primary transition-transform group-hover/topic:-translate-y-0.5 group-hover/topic:translate-x-0.5 motion-reduce:transform-none"
          />
        </span>
        <span className="mt-4 block font-mono text-[0.6875rem] text-sidebar-foreground/58">
          {formatMaterialCount(topic.count)}
        </span>
      </span>
    </a>
  );
}

function TopicFilterCard({
  onSelect,
  selected,
  topic,
}: {
  readonly onSelect: () => void;
  readonly selected: boolean;
  readonly topic: TopicFixture;
}) {
  return (
    <button
      aria-label={`Показать материалы темы ${topic.title}, ${formatMaterialCount(topic.count)}`}
      aria-pressed={selected}
      className={cn(
        "group/topic relative isolate min-h-72 overflow-clip rounded-2xl bg-sidebar text-left text-sidebar-foreground shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-sidebar-ring motion-reduce:transform-none motion-reduce:transition-none",
        selected && "outline-3 outline-offset-3 outline-ring",
      )}
      onClick={onSelect}
      type="button"
    >
      <TopicArtwork topic={topic} />
      <span className="absolute inset-x-0 bottom-0 z-10 bg-sidebar/95 p-5">
        <span className="flex items-start justify-between gap-3">
          <span className="block text-xl font-semibold leading-[1.18] tracking-[-0.03em]">
            {topic.title}
          </span>
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent text-sidebar-primary",
              selected && "bg-sidebar-primary text-sidebar-primary-foreground",
            )}
          >
            <ListFilter aria-hidden="true" className="size-4" />
          </span>
        </span>
        <span className="mt-2 block text-sm leading-5 text-sidebar-foreground/70">
          {topic.description}
        </span>
        <span className="mt-4 flex items-center justify-between gap-3 font-mono text-[0.6875rem] text-sidebar-foreground/58">
          {formatMaterialCount(topic.count)}
          {selected ? <span className="text-sidebar-primary">Тема выбрана</span> : null}
        </span>
      </span>
    </button>
  );
}

function HorizontalTopicCard({ topic }: { readonly topic: TopicFixture }) {
  return (
    <a
      className="group/topic grid min-h-40 overflow-clip rounded-2xl bg-card text-foreground no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-ring motion-reduce:transform-none motion-reduce:transition-none @min-[52rem]/knowledge:grid-rows-[8rem_auto]"
      href={`/topics/${topic.slug}`}
    >
      <TopicArtwork compact topic={topic} />
      <span className="flex min-w-0 items-end justify-between gap-3 p-4">
        <span className="min-w-0">
          <span className="block text-base font-semibold leading-5 tracking-[-0.02em]">
            {topic.title}
          </span>
          <span className="mt-2 block font-mono text-[0.6875rem] text-muted-foreground">
            {formatMaterialCount(topic.count)}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-5 shrink-0 text-accent transition-transform group-hover/topic:-translate-y-0.5 group-hover/topic:translate-x-0.5 motion-reduce:transform-none"
        />
      </span>
    </a>
  );
}

function TopicArtwork({
  compact = false,
  featured = false,
  topic,
}: {
  readonly compact?: boolean;
  readonly featured?: boolean;
  readonly topic: TopicFixture;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-0 overflow-clip bg-sidebar",
        compact && "relative block min-h-32",
      )}
      data-topic-visual={topic.visual}
    >
      <span className="absolute inset-x-6 top-7 h-px bg-sidebar-border sm:inset-x-8" />
      <span className="absolute bottom-0 left-10 top-0 w-px bg-sidebar-border/75" />
      <span className="absolute right-8 top-6 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-sidebar-foreground/70">
        {topic.visual === "product"
          ? "контур"
          : topic.visual === "ai"
            ? "система"
            : "маршрут"}
      </span>
      <span
        className={cn(
          "absolute left-6 right-6 top-16 grid grid-cols-3 items-center gap-2 sm:left-8 sm:right-8",
          featured && "@min-[46rem]/knowledge:left-12 @min-[46rem]/knowledge:right-12 @min-[46rem]/knowledge:top-20",
          compact && "left-4 right-4 top-12",
        )}
      >
        {topic.diagram.map((step, index) => (
          <span
            className={cn(
              "relative grid min-h-14 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent px-2 text-center font-mono text-[0.6875rem] leading-4 text-sidebar-accent-foreground",
              topic.visual === "career" && index === 1 && "-translate-y-3",
              topic.visual === "career" && index === 2 && "-translate-y-6",
              topic.visual === "ai" &&
                index === 1 &&
                "border-sidebar-primary text-sidebar-accent-foreground",
              compact && "min-h-10",
            )}
            key={step}
          >
            {step}
            {index < topic.diagram.length - 1 ? (
              <span className="absolute left-full top-1/2 h-px w-2 bg-sidebar-primary" />
            ) : null}
          </span>
        ))}
      </span>
    </span>
  );
}

function PlaylistCard({ playlist }: { readonly playlist: PlaylistFixture }) {
  return (
    <a
      className="group/playlist grid min-h-32 overflow-clip rounded-2xl bg-secondary text-foreground no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-ring motion-reduce:transform-none motion-reduce:transition-none @min-[34rem]/knowledge:grid-cols-[9rem_minmax(0,1fr)]"
      href={`/series/${playlist.slug}`}
    >
      <PlaylistArtwork />
      <span className="flex min-w-0 items-center justify-between gap-4 p-5">
        <span className="min-w-0">
          <span className="block text-lg font-semibold leading-6 tracking-[-0.025em]">
            {playlist.title}
          </span>
          <span className="mt-2 block text-sm leading-5 text-muted-foreground">
            {playlist.description}
          </span>
          <span className="mt-3 block font-mono text-[0.6875rem] text-muted-foreground">
            {formatMaterialCount(playlist.count)}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-5 shrink-0 text-accent transition-transform group-hover/playlist:-translate-y-0.5 group-hover/playlist:translate-x-0.5 motion-reduce:transform-none"
        />
      </span>
    </a>
  );
}

function FeaturedPlaylistCard({ playlist }: { readonly playlist: PlaylistFixture }) {
  return (
    <a
      className="group/playlist grid min-h-72 overflow-clip rounded-2xl bg-sidebar text-sidebar-foreground no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-sidebar-ring motion-reduce:transform-none motion-reduce:transition-none @min-[46rem]/knowledge:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]"
      href={`/series/${playlist.slug}`}
    >
      <PlaylistArtwork featured />
      <span className="flex min-w-0 flex-col justify-end p-6 sm:p-8">
        <span className="flex items-start justify-between gap-5">
          <span className="block max-w-[20ch] text-2xl font-semibold leading-[1.12] tracking-[-0.03em] sm:text-3xl">
            {playlist.title}
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="size-6 shrink-0 text-sidebar-primary transition-transform group-hover/playlist:-translate-y-0.5 group-hover/playlist:translate-x-0.5 motion-reduce:transform-none"
          />
        </span>
        <span className="mt-4 block max-w-[48ch] text-sm leading-6 text-sidebar-foreground/70">
          {playlist.description}
        </span>
        <span className="mt-6 block font-mono text-[0.6875rem] text-sidebar-foreground/58">
          {formatMaterialCount(playlist.count)} · авторский порядок
        </span>
      </span>
    </a>
  );
}

function PlaylistArtwork({ featured = false }: { readonly featured?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid min-h-32 place-items-center overflow-clip bg-sidebar text-sidebar-foreground",
        featured && "min-h-56 border-b border-sidebar-border @min-[46rem]/knowledge:border-b-0 @min-[46rem]/knowledge:border-r",
      )}
    >
      <span className="absolute inset-x-5 top-5 h-px bg-sidebar-border" />
      <span className="absolute bottom-5 left-5 top-5 w-px bg-sidebar-border" />
      <span
        className={cn(
          "grid grid-cols-[repeat(3,2.75rem)] items-center gap-2",
          featured && "grid-cols-[repeat(3,4rem)] gap-3",
        )}
      >
        {["1", "2", "3"].map((step) => (
          <span
            className={cn(
              "relative grid size-11 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent font-mono text-xs text-sidebar-accent-foreground",
              featured && "size-16 text-sm",
            )}
            key={step}
          >
            {step}
            {step !== "3" ? (
              <span className="absolute left-full top-1/2 h-px w-2 bg-sidebar-primary" />
            ) : null}
          </span>
        ))}
      </span>
      <ListVideo className="absolute bottom-5 right-5 size-5 text-sidebar-primary" />
    </span>
  );
}

function CatalogSection({
  activeContext = null,
  materials: availableMaterials,
  onResetContext,
}: {
  readonly activeContext?: string | null;
  readonly materials: readonly MaterialPreviewFixture[];
  readonly onResetContext?: (() => void) | undefined;
}) {
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedFormats, setSelectedFormats] = useState<readonly string[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<readonly string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>([]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleMaterials = availableMaterials.filter((material) => {
    const searchableText = [
      material.title,
      material.summary,
      material.topic,
      ...material.tags,
      ...material.series.map((series) => series.title),
    ]
      .join(" ")
      .toLocaleLowerCase("ru");

    return (
      (normalizedQuery.length === 0 || searchableText.includes(normalizedQuery)) &&
      (selectedTopics.length === 0 || selectedTopics.includes(material.topic)) &&
      (selectedFormats.length === 0 || selectedFormats.includes(material.format)) &&
      (selectedPlaylists.length === 0 ||
        material.series.some((series) => selectedPlaylists.includes(series.id)))
    );
  });

  return (
    <section aria-labelledby="all-materials-heading" className="mt-12 sm:mt-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            className="text-xl font-semibold tracking-[-0.025em] sm:text-2xl"
            id="all-materials-heading"
          >
            Все материалы
          </h2>
          <p aria-live="polite" className="mt-1 font-mono text-xs text-muted-foreground">
            {formatMaterialCount(visibleMaterials.length)}
          </p>
        </div>
        {activeContext !== null && onResetContext !== undefined ? (
          <Button
            aria-label={`Сбросить тему: ${activeContext}`}
            className="min-h-10 gap-2 px-3 text-xs"
            onClick={onResetContext}
            variant="secondary"
          >
            {activeContext}
            <X aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <div className="mt-5 grid gap-2 @min-[40rem]/knowledge:grid-cols-[minmax(0,1fr)_auto]">
        <label className="relative block">
          <span className="sr-only">Поиск по базе знаний</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className="min-h-11 w-full rounded-xl border border-input bg-card pl-10 pr-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Название, тема или тег"
            type="search"
            value={query}
          />
        </label>
        <Button
          aria-controls="prototype-catalog-filters"
          aria-expanded={filtersExpanded}
          className="min-h-11 justify-center bg-card px-4"
          onClick={() => {
            setFiltersExpanded((current) => !current);
          }}
          variant="outline"
        >
          <ListFilter aria-hidden="true" className="size-4" />
          Фильтры
        </Button>
      </div>

      {filtersExpanded ? (
        <div
          className="mt-2 rounded-xl bg-muted p-3"
          id="prototype-catalog-filters"
        >
          <LibraryFilters
            density="compact"
            formatOptions={["Гайд", "Видео"]}
            selectedFormats={selectedFormats}
            selectedSeriesIds={selectedPlaylists}
            selectedTopics={selectedTopics}
            seriesLabel="Плейлист"
            seriesOptions={playlists.map((playlist) => ({
              label: playlist.title,
              value: `series-${playlist.slug}`,
            }))}
            setSelectedFormats={setSelectedFormats}
            setSelectedSeriesIds={setSelectedPlaylists}
            setSelectedTopics={setSelectedTopics}
            topicOptions={topics.map((topic) => topic.title)}
          />
        </div>
      ) : null}

      {visibleMaterials.length > 0 ? (
        <div className="mt-5 grid items-start justify-items-center gap-4 @min-[42rem]/knowledge:grid-cols-2 @min-[68rem]/knowledge:grid-cols-3">
          {visibleMaterials.map((material) => (
            <MaterialCard headingLevel="h3" key={material.id} material={material} />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl bg-muted px-5 py-8 text-center sm:px-8">
          <h3 className="text-lg font-semibold">
            {availableMaterials.length === 0 ? "Материалов пока нет" : "Ничего не найдено"}
          </h3>
          <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-6 text-muted-foreground">
            {availableMaterials.length === 0
              ? "Опубликованные материалы появятся здесь автоматически."
              : "Измените поисковый запрос или выбранные фильтры."}
          </p>
        </div>
      )}
    </section>
  );
}

function DiscoveryEmpty({ kind }: { readonly kind: "playlists" | "topics" }) {
  return (
    <div className="mt-4 rounded-2xl bg-muted px-5 py-7 sm:px-8">
      <p className="text-base font-semibold">
        {kind === "topics" ? "Тем пока нет" : "Плейлистов пока нет"}
      </p>
      <p className="mt-2 max-w-[48ch] text-sm leading-6 text-muted-foreground">
        {kind === "topics"
          ? "Темы появятся вместе с опубликованными материалами."
          : "Авторские последовательности появятся здесь после публикации."}
      </p>
    </div>
  );
}

function PrototypeSwitcher({
  chooseVariant,
  variant,
}: {
  readonly chooseVariant: (variant: KnowledgeBaseVariant) => void;
  readonly variant: KnowledgeBaseVariant;
}) {
  const current = variants.find((item) => item.key === variant) ?? variants[0];

  return (
    <nav
      aria-label="Варианты прототипа"
      className="sticky top-2 z-50 mx-auto mt-3 flex w-fit items-center gap-1 rounded-xl bg-foreground p-1 text-background shadow-card md:fixed md:bottom-5 md:left-1/2 md:top-auto md:m-0 md:-translate-x-1/2"
    >
      <button
        aria-label="Предыдущий вариант"
        className="grid size-10 place-items-center rounded-lg hover:bg-background/12 focus-visible:outline-background"
        onClick={() => {
          chooseVariant(adjacentVariant(variant, -1));
        }}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <span className="min-w-40 px-2 text-center text-xs font-semibold sm:min-w-48">
        {current.label}
      </span>
      <button
        aria-label="Следующий вариант"
        className="grid size-10 place-items-center rounded-lg hover:bg-background/12 focus-visible:outline-background"
        onClick={() => {
          chooseVariant(adjacentVariant(variant, 1));
        }}
        type="button"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}

interface ScenarioData {
  readonly materials: readonly MaterialPreviewFixture[];
  readonly playlists: readonly PlaylistFixture[];
  readonly topics: readonly TopicFixture[];
}

function getScenarioData(scenario: KnowledgeBaseScenario): ScenarioData {
  if (scenario === "empty") {
    return { materials: [], playlists: [], topics: [] };
  }

  if (scenario === "sparse") {
    return {
      materials: [materialFixtures.publicAgentGuide],
      playlists: [],
      topics: [topics[1]],
    };
  }

  return { materials, playlists, topics };
}

function adjacentVariant(
  current: KnowledgeBaseVariant,
  offset: -1 | 1,
): KnowledgeBaseVariant {
  const currentIndex = variants.findIndex((item) => item.key === current);
  const nextIndex = (currentIndex + offset + variants.length) % variants.length;
  return variants[nextIndex]?.key ?? "featured";
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
