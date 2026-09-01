"use client";

import {
  ArrowUpRight,
  ListFilter,
  X,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import {
  applyMaterialCatalogState,
  MaterialCatalogControls,
  type MaterialSortOrder,
} from "@/workshop/material-catalog-controls.prototype";
import {
  MaterialCard,
  materialFixtures,
  type MaterialPreviewFixture,
} from "@/workshop/material-preview.prototype";
import { PlaylistCard as SharedPlaylistCard } from "@/workshop/playlist-card.prototype";

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

export function KnowledgeBasePrototype({
  initialVariant = "featured",
  scenario = "populated",
}: KnowledgeBasePrototypeProps) {
  const scenarioData = getScenarioData(scenario);

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
        data-prototype-variant={initialVariant}
      >
        <KnowledgeBaseHeader />
        <div className="px-5 pb-24 sm:px-8 sm:pb-28 md:px-0 md:pb-24">
          {initialVariant === "featured" ? (
            <FeaturedTopicsVariant {...scenarioData} />
          ) : initialVariant === "equal" ? (
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
        Темы, плейлисты и материалы Sachkov Inside.
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
        title="Темы"
      />
      {availableTopics.length > 0 ? (
        <div className="mt-4 grid gap-4 @min-[42rem]/knowledge:grid-cols-2 @min-[60rem]/knowledge:grid-cols-3">
          {availableTopics.map((topic) => (
            <TopicLinkCard key={topic.slug} topic={topic} />
          ))}
        </div>
      ) : (
        <DiscoveryEmpty kind="topics" />
      )}

      <DiscoverySectionHeader
        className="mt-10 sm:mt-12"
        title="Плейлисты"
      />
      {availablePlaylists.length > 0 ? (
        <div className="@container/playlist-surface mt-4 grid gap-4 @min-[48rem]/knowledge:grid-cols-2">
          {availablePlaylists.map((playlist) => (
            <SharedPlaylistCard
              key={playlist.slug}
              playlist={{
                countLabel: formatMaterialCount(playlist.count),
                name: playlist.title,
                slug: playlist.slug,
                summary: playlist.description,
              }}
            />
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
        title="Плейлисты"
      />
      {availablePlaylists.length > 0 ? (
        <section aria-label="Плейлисты">
          <div className="@container/playlist-surface mt-4 grid gap-4 @min-[48rem]/knowledge:grid-cols-2">
            {availablePlaylists.map((playlist) => (
              <SharedPlaylistCard
                key={playlist.slug}
                playlist={{
                  countLabel: formatMaterialCount(playlist.count),
                  name: playlist.title,
                  slug: playlist.slug,
                  summary: playlist.description,
                }}
              />
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
        title="Плейлисты"
      />
      {availablePlaylists.length > 0 ? (
        <div className="@container/playlist-surface mt-4 grid max-w-[68rem] gap-4 @min-[48rem]/knowledge:grid-cols-2">
          {availablePlaylists.map((playlist) => (
            <SharedPlaylistCard
              key={playlist.slug}
              playlist={{
                countLabel: formatMaterialCount(playlist.count),
                name: playlist.title,
                slug: playlist.slug,
                summary: playlist.description,
              }}
            />
          ))}
        </div>
      ) : (
        <DiscoveryEmpty kind="playlists" />
      )}

      <DiscoverySectionHeader
        className="mt-10 sm:mt-12"
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
  title,
}: {
  readonly className?: string;
  readonly title: string;
}) {
  return (
    <div className={className}>
      <h2 className="text-xl font-semibold tracking-[-0.025em] sm:text-2xl">{title}</h2>
    </div>
  );
}

function TopicLinkCard({ topic }: { readonly topic: TopicFixture }) {
  return (
    <a
      className="group/topic relative isolate min-h-64 overflow-clip rounded-2xl bg-sidebar text-sidebar-foreground no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-sidebar-ring motion-reduce:transform-none motion-reduce:transition-none"
      data-topic-card="link"
      href={`/topics/${topic.slug}`}
    >
      <TopicArtwork topic={topic} />
      <span className="absolute inset-x-0 bottom-0 z-10 bg-sidebar/95 p-5 sm:p-6">
        <span className="flex items-start justify-between gap-4">
          <span>
            <span className="block max-w-[24ch] text-xl font-semibold leading-[1.18] tracking-[-0.03em]">
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
  topic,
}: {
  readonly compact?: boolean;
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

function CatalogSection({
  activeContext = null,
  materials: availableMaterials,
  onResetContext,
}: {
  readonly activeContext?: string | null;
  readonly materials: readonly MaterialPreviewFixture[];
  readonly onResetContext?: (() => void) | undefined;
}) {
  const [query, setQuery] = useState("");
  const [selectedFormats, setSelectedFormats] = useState<readonly string[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<readonly string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>([]);
  const [sortOrder, setSortOrder] = useState<MaterialSortOrder>("default");
  const visibleMaterials = applyMaterialCatalogState(availableMaterials, {
    query,
    selectedFormats,
    selectedSeriesIds: selectedPlaylists,
    selectedTopics,
    sortOrder,
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

      <MaterialCatalogControls
        formatOptions={["Гайд", "Видео"]}
        idPrefix="knowledge-materials"
        query={query}
        selectedFormats={selectedFormats}
        selectedSeriesIds={selectedPlaylists}
        selectedTopics={selectedTopics}
        seriesOptions={playlists.map((playlist) => ({
          label: playlist.title,
          value: `series-${playlist.slug}`,
        }))}
        setQuery={setQuery}
        setSelectedFormats={setSelectedFormats}
        setSelectedSeriesIds={setSelectedPlaylists}
        setSelectedTopics={setSelectedTopics}
        setSortOrder={setSortOrder}
        sortOrder={sortOrder}
        topicOptions={topics.map((topic) => topic.title)}
      />

      {visibleMaterials.length > 0 ? (
        <div className="mt-5 grid items-stretch justify-items-center gap-4 @min-[42rem]/knowledge:grid-cols-2 @min-[68rem]/knowledge:grid-cols-3">
          {visibleMaterials.map((material) => (
            <MaterialCard headingLevel="h3" key={material.id} material={material} />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl bg-muted px-5 py-8 text-center sm:px-8">
          <h3 className="text-lg font-semibold">
            {availableMaterials.length === 0 ? "Материалов пока нет" : "Ничего не найдено"}
          </h3>
          {availableMaterials.length === 0 ? null : (
            <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-6 text-muted-foreground">
              Измените поисковый запрос или выбранные фильтры.
            </p>
          )}
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
    </div>
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
