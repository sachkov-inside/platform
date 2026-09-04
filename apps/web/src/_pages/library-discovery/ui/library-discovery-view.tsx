import {
  ArrowLeft,
  LibraryBig,
  ListVideo,
  RefreshCw,
  SearchX,
  ShieldAlert,
  Tags,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type {
  LibraryDiscoveryKind,
  PublishedSeriesResult,
  PublishedTopicResult,
} from "@/features/library-discovery";
import {
  ContentCoverImage,
  MaterialCard,
  materialPreviewHasVideo,
} from "@/entities/material";
import { PlaylistCard, formatMaterialCount } from "@/features/library-discovery";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { PublicSectionHeading } from "@/shared/ui/public-section-heading";
import {
  collectionDiscoveryHref,
  libraryMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { PublicProductHeader } from "@/widgets/application-shell";
import { TopicMaterialCatalog } from "./topic-material-catalog.client";

type ResolvedDiscoveryResult = Exclude<
  PublishedSeriesResult | PublishedTopicResult,
  { readonly kind: "not-found" | "unavailable" }
>;

export function LibraryDiscoveryView({
  result,
  returnTarget = libraryMaterialReaderReturnTarget,
}: {
  readonly result: ResolvedDiscoveryResult;
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  const isSeries = result.discoveryKind === "series";
  const Icon = isSeries ? ListVideo : Tags;
  const currentHref = collectionDiscoveryHref(
    result.discoveryKind,
    result.reference.slug,
    returnTarget.href,
  );

  return (
    <div
      className="@container/discovery min-w-0"
      data-discovery-kind={result.discoveryKind}
      data-discovery-state={result.kind}
    >
      <PublicProductHeader />
      <DiscoveryBreadcrumb
        kind={result.discoveryKind}
        name={result.reference.name}
        returnTarget={returnTarget}
      />
      <DiscoveryHero Icon={Icon} isSeries={isSeries} result={result} />

      {result.kind === "empty" ? (
        <DiscoveryEmpty kind={result.discoveryKind} />
      ) : isSeries ? (
        <SeriesMaterials currentHref={currentHref} result={result} />
      ) : (
        <TopicMaterials currentHref={currentHref} result={result} />
      )}
    </div>
  );
}

function DiscoveryHero({
  Icon,
  isSeries,
  result,
}: {
  readonly Icon: LucideIcon;
  readonly isSeries: boolean;
  readonly result: ResolvedDiscoveryResult;
}) {
  return (
    <header
      className={cn(
        "mt-5 overflow-hidden rounded-[2rem] p-6 md:p-10",
        isSeries
          ? "bg-[#202124] text-white"
          : cn(discoveryToneClass(result.reference.slug), "text-[#202124]"),
      )}
    >
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div className="min-w-0">
          <p
            className={cn(
              "text-xs font-bold uppercase tracking-[0.14em]",
              isSeries ? "text-white/65" : "text-[#4d4e51]",
            )}
          >
            {isSeries ? (
              <>
                Плейлист ·{" "}
                {formatMaterialCount(
                  result.kind === "ready" ? result.items.length : 0,
                )}
              </>
            ) : (
              "Тема"
            )}
          </p>
          <h1 className="mt-3 max-w-3xl break-words text-[2.35rem] font-semibold leading-none tracking-[-0.055em] md:text-6xl">
            {result.reference.name}
          </h1>
          {result.reference.summary ? (
            <p
              className={cn(
                "mt-4 max-w-2xl text-base leading-7 md:text-lg",
                isSeries ? "text-white/65" : "text-[#4d4e51]",
              )}
            >
              {result.reference.summary}
            </p>
          ) : null}
        </div>
        {isSeries && result.kind === "ready" ? (
          <div className="grid w-full max-w-xl grid-cols-3 gap-2 md:w-[24rem]">
            {Array.from({ length: 3 }, (_, index) => {
              const material = result.items[index];
              return (
                <ContentCoverImage
                  alt=""
                  className="aspect-[4/3] min-h-0 rounded-2xl"
                  cover={material?.cover ?? null}
                  fallbackKind={
                    material !== undefined && materialPreviewHasVideo(material)
                      ? "video"
                      : "material"
                  }
                  fallbackSeed={material?.slug ?? `${result.reference.slug}-${String(index)}`}
                  key={material?.slug ?? index}
                  sizes="10rem"
                />
              );
            })}
          </div>
        ) : (
          <span className="grid size-24 shrink-0 rotate-[-5deg] place-items-center rounded-[1.6rem] border border-white/45 bg-white/75 text-[#202124] shadow-xl backdrop-blur-sm md:size-32">
            <Icon aria-hidden="true" className="size-12 md:size-16" strokeWidth={1.6} />
          </span>
        )}
      </div>
    </header>
  );
}

function TopicMaterials({
  currentHref,
  result,
}: {
  readonly currentHref: Route;
  readonly result: Extract<ResolvedDiscoveryResult, { readonly kind: "ready" }>;
}) {
  return (
    <>
      <section aria-labelledby="topic-playlists">
        <DiscoverySectionHeading
          count={result.relatedSeries.length}
          id="topic-playlists"
          title="Плейлисты"
        />
        {result.relatedSeries.length > 0 ? (
          <div className="@container/playlist-surface mt-4 grid gap-4 @min-[48rem]/discovery:grid-cols-2">
            {result.relatedSeries.map((playlist) => (
              <PlaylistCard
                key={playlist.slug}
                returnHref={currentHref}
                playlist={{
                  countLabel: `${formatMaterialCount(playlist.matchingMaterialCount)} в теме · ${formatMaterialCount(playlist.totalMaterialCount)} всего`,
                  cover: playlist.cover,
                  name: playlist.name,
                  slug: playlist.slug,
                  summary: playlist.summary,
                }}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-muted px-5 py-7 font-semibold sm:px-8">
            Связанных плейлистов пока нет
          </p>
        )}
      </section>
      <TopicMaterialCatalog
        key={result.reference.slug}
        returnHref={currentHref}
        topicSlug={result.reference.slug}
      />
    </>
  );
}

function SeriesMaterials({
  currentHref,
  result,
}: {
  readonly currentHref: Route;
  readonly result: Extract<ResolvedDiscoveryResult, { readonly kind: "ready" }>;
}) {
  const topics = result.topics;

  return (
    <section aria-labelledby="series-materials">
      <PublicSectionHeading
        aside={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="text-sm font-semibold text-[#5f5e59]">
              {result.items.length}
            </p>
            {topics.length > 0 ? (
              <nav aria-label="Темы плейлиста">
                <ul className="flex flex-wrap gap-2" role="list">
                  {topics.map((topic) => (
                    <li key={topic.slug}>
                      <Link
                        className="inline-flex min-h-9 items-center rounded-full bg-[#f3f1ed] px-3 text-sm font-semibold text-[#5f5e59] no-underline hover:text-[#202124] focus-visible:outline-ring"
                        href={collectionDiscoveryHref(
                          "topic",
                          topic.slug,
                          currentHref,
                        )}
                        prefetch={false}
                      >
                        {topic.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>
        }
        className="mt-11 flex-wrap"
        id="series-materials"
        title="Маршрут"
      />
      <ol className="mt-4 grid gap-3" data-series-order>
        {result.items.map((material, index) => {
          const ordinal =
            material.seriesMemberships.find(
              ({ slug }) => slug === result.reference.slug,
            )?.ordinal ?? index + 1;
          return (
            <li
              className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3"
              data-series-ordinal={ordinal}
              key={material.slug}
            >
              <div className="flex min-h-11 items-center font-semibold text-[#5f5e59]">
                <span className="grid size-8 place-items-center rounded-full bg-[#f3f1ed] text-xs font-bold">
                  {ordinal}
                </span>
              </div>
              <MaterialCard
                headingLevel="h3"
                material={material}
                returnHref={currentHref}
                variant="row"
              />
            </li>
          );
        })}
      </ol>
      <DiscoveryContinuation result={result} />
    </section>
  );
}

function DiscoveryContinuation({
  result,
}: {
  readonly result: Extract<ResolvedDiscoveryResult, { readonly kind: "ready" }>;
}) {
  if (!result.hasNext) {
    return null;
  }
  const parameter = result.discoveryKind === "series" ? "series" : "topic";
  return (
    <Button asChild className="mt-6" variant="outline">
      <Link href={`/library?${parameter}=${encodeURIComponent(result.reference.slug)}`}>
        Показать все материалы
      </Link>
    </Button>
  );
}

function DiscoveryEmpty({ kind }: { readonly kind: LibraryDiscoveryKind }) {
  return (
    <section className="mt-8 max-w-[48rem] rounded-2xl bg-muted px-6 py-7 sm:mt-10 sm:px-8">
      <LibraryBig aria-hidden="true" className="size-6 text-accent" />
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
        {kind === "series" ? "В плейлисте пока нет материалов" : "В теме пока нет материалов"}
      </h2>
      <Button asChild className="mt-6" size="lg" variant="outline">
        <Link href="/library">Открыть Базу знаний</Link>
      </Button>
    </section>
  );
}

function DiscoveryBreadcrumb({
  kind,
  name,
  returnTarget,
}: {
  readonly kind: LibraryDiscoveryKind;
  readonly name: string;
  readonly returnTarget: MaterialReaderReturnTarget;
}) {
  return (
    <nav aria-label="Хлебные крошки" className="mt-7">
      <ol className="flex min-h-10 flex-wrap items-center gap-2 text-sm text-[#5f5e59]">
        <li>
          <Link
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#f3f1ed] px-4 font-semibold no-underline hover:text-[#202124] focus-visible:outline-ring"
            href={returnTarget.href}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {returnTarget.label}
          </Link>
        </li>
        <li className="sr-only">{kind === "series" ? "Плейлист" : "Тема"}</li>
        <li aria-current="page" className="sr-only">{name}</li>
      </ol>
    </nav>
  );
}

function DiscoverySectionHeading({
  count,
  id,
  title,
}: {
  readonly count: number;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <PublicSectionHeading
      aside={
        <span className="text-sm font-semibold text-[#5f5e59]">{count}</span>
      }
      className="mt-11"
      id={id}
      title={title}
    />
  );
}

function discoveryToneClass(seed: string): string {
  const tones = [
    "bg-[#dce9ff]",
    "bg-[#ffdcd2]",
    "bg-[#e9e1ff]",
    "bg-[#dcefe5]",
    "bg-[#eee8dc]",
  ] as const;
  const value = Array.from(seed).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0,
    0,
  );
  return tones[value % tones.length] ?? tones[0];
}

export function LibraryDiscoveryLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Подборка загружается"
      className="max-w-[58rem]"
      data-discovery-state="loading"
    >
      <div className="h-10 w-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="mt-6 animate-pulse rounded-2xl bg-secondary px-6 py-8 motion-reduce:animate-none sm:px-8">
        <div className="size-11 rounded-xl bg-muted" />
        <div className="mt-6 h-10 w-3/4 rounded-xl bg-muted" />
        <div className="mt-4 h-5 w-full max-w-xl rounded-lg bg-muted/80" />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="h-52 rounded-xl bg-muted" />
        <div className="h-52 rounded-xl bg-muted" />
      </div>
      <p className="sr-only">Загружаем опубликованные материалы</p>
    </div>
  );
}

export function LibraryDiscoveryUnavailable({
  kind,
  slug,
}: {
  readonly kind: Exclude<LibraryDiscoveryKind, "related">;
  readonly slug: string;
}) {
  return (
    <DiscoveryStatus
      action={
        <Button asChild size="lg">
          <Link href={`/${kind === "topic" ? "topics" : "series"}/${slug}`}>
            <RefreshCw aria-hidden="true" />
            Повторить
          </Link>
        </Button>
      }
      icon={<ShieldAlert aria-hidden="true" />}
      message="Каталог не отвечает. Попробуйте ещё раз через несколько минут."
      state="unavailable"
      title="Подборка временно недоступна"
    />
  );
}

export function LibraryDiscoveryNotFound() {
  return (
    <DiscoveryStatus
      action={
        <Button asChild size="lg">
          <Link href="/library">
            <ArrowLeft aria-hidden="true" />
            В Базу знаний
          </Link>
        </Button>
      }
      icon={<SearchX aria-hidden="true" />}
      message="Проверьте адрес или выберите другую тему или плейлист в Базе знаний."
      state="not-found"
      title="Подборка не найдена"
    />
  );
}

export function LibraryDiscoveryUnexpectedError({
  onRetry,
}: {
  readonly onRetry: () => void;
}) {
  return (
    <DiscoveryStatus
      action={
        <Button onClick={onRetry} size="lg">
          <RefreshCw aria-hidden="true" />
          Повторить
        </Button>
      }
      icon={<ShieldAlert aria-hidden="true" />}
      message="Не удалось загрузить подборку. Попробуйте ещё раз."
      state="unexpected-error"
      title="Подборка сейчас недоступна"
    />
  );
}

function DiscoveryStatus({
  action,
  icon,
  message,
  state,
  title,
}: {
  readonly action: React.ReactNode;
  readonly icon: React.ReactNode;
  readonly message: string;
  readonly state: string;
  readonly title: string;
}) {
  return (
    <section className="max-w-[48rem] pt-1 sm:pt-3" data-discovery-state={state}>
      <div className="relative isolate overflow-clip rounded-2xl bg-secondary px-6 py-7 shadow-card sm:px-8 sm:py-9">
        <span
          aria-hidden="true"
          className="reader-status-halo absolute -right-10 -top-16 size-48 rounded-full bg-accent/15"
        />
        <span className="relative grid size-12 place-items-center rounded-xl bg-background/80 text-accent [&_svg]:size-6">
          {icon}
        </span>
        <h1 className="relative mt-5 max-w-[18ch] text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
          {title}
        </h1>
        <p className="relative mt-4 max-w-[60ch] text-pretty leading-7 text-muted-foreground">
          {message}
        </p>
        <div className="relative mt-7">{action}</div>
      </div>
    </section>
  );
}
