import {
  ArrowLeft,
  BookOpenText,
  LibraryBig,
  ListVideo,
  LockKeyhole,
  RefreshCw,
  SearchX,
  ShieldAlert,
  Tags,
  Unlock,
} from "lucide-react";
import Link from "next/link";

import type {
  LibraryDiscoveryKind,
  PublishedSeriesResult,
  PublishedTopicResult,
} from "@/features/library-discovery";
import type { MaterialPreview } from "@/entities/material";
import { PlaylistCard, formatMaterialCount } from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { TopicMaterialCatalog } from "./topic-material-catalog.client";

type ResolvedDiscoveryResult = Exclude<
  PublishedSeriesResult | PublishedTopicResult,
  { readonly kind: "not-found" | "unavailable" }
>;

export function LibraryDiscoveryView({
  result,
}: {
  readonly result: ResolvedDiscoveryResult;
}) {
  const isSeries = result.discoveryKind === "series";
  const Icon = isSeries ? ListVideo : Tags;

  return (
    <div
      className="@container/discovery min-w-0"
      data-discovery-kind={result.discoveryKind}
      data-discovery-state={result.kind}
    >
      <DiscoveryBreadcrumb
        kind={result.discoveryKind}
        name={result.reference.name}
      />
      <header className="relative mt-6 isolate overflow-clip rounded-2xl bg-secondary px-5 py-7 shadow-card sm:mt-8 sm:px-8 sm:py-9">
        <span
          aria-hidden="true"
          className="reader-status-halo absolute -right-12 -top-20 size-56 rounded-full bg-accent/15"
        />
        <span className="relative grid size-11 place-items-center rounded-xl bg-background/80 text-accent [&_svg]:size-5">
          <Icon aria-hidden="true" />
        </span>
        <p className="relative mt-5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {isSeries ? "Плейлист" : "Тема"}
        </p>
        <h1 className="relative mt-2 max-w-[24ch] break-words text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-4xl @min-[64rem]/discovery:text-5xl">
          {result.reference.name}
        </h1>
        {result.reference.summary ? (
          <p className="relative mt-4 max-w-[64ch] text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            {result.reference.summary}
          </p>
        ) : null}
      </header>

      {result.kind === "empty" ? (
        <DiscoveryEmpty kind={result.discoveryKind} />
      ) : isSeries ? (
        <SeriesMaterials result={result} />
      ) : (
        <TopicMaterials result={result} />
      )}
    </div>
  );
}

function TopicMaterials({
  result,
}: {
  readonly result: Extract<ResolvedDiscoveryResult, { readonly kind: "ready" }>;
}) {
  return (
    <>
      <section aria-labelledby="topic-playlists" className="mt-8 sm:mt-10">
        <h2 className="text-xl font-semibold tracking-[-0.025em]" id="topic-playlists">
          Плейлисты
        </h2>
        {result.relatedSeries.length > 0 ? (
          <div className="@container/playlist-surface mt-4 grid gap-4 @min-[48rem]/discovery:grid-cols-2">
            {result.relatedSeries.map((playlist) => (
              <PlaylistCard
                key={playlist.slug}
                playlist={{
                  countLabel: `${formatMaterialCount(playlist.matchingMaterialCount)} в теме · ${formatMaterialCount(playlist.totalMaterialCount)} всего`,
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
        topicSlug={result.reference.slug}
      />
    </>
  );
}

function SeriesMaterials({
  result,
}: {
  readonly result: Extract<ResolvedDiscoveryResult, { readonly kind: "ready" }>;
}) {
  const topics = result.topics;

  return (
    <section aria-labelledby="series-materials" className="mt-8 sm:mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em]" id="series-materials">
            Выпуски
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {formatMaterialCount(result.items.length)}
          </p>
        </div>
        {topics.length > 0 ? (
          <nav aria-label="Темы плейлиста">
            <ul className="flex flex-wrap gap-2" role="list">
              {topics.map((topic) => (
                <li key={topic.slug}>
                  <Link
                    className="inline-flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm font-semibold no-underline hover:bg-secondary focus-visible:outline-ring"
                    href={`/topics/${topic.slug}`}
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
      <ol className="mt-5 grid max-w-[58rem] gap-5" data-series-order>
        {result.items.map((material, index) => {
          const ordinal =
            material.seriesMemberships.find(
              ({ slug }) => slug === result.reference.slug,
            )?.ordinal ?? index + 1;
          return (
            <li
              className="grid items-start gap-3 @min-[38rem]/discovery:grid-cols-[6rem_minmax(0,1fr)]"
              data-series-ordinal={ordinal}
              key={material.slug}
            >
              <div className="flex min-h-11 items-center gap-2 font-mono text-xs font-semibold text-muted-foreground @min-[38rem]/discovery:pt-4">
                <span className="grid size-8 place-items-center rounded-full bg-accent/10 text-foreground">
                  {ordinal}
                </span>
                Выпуск
              </div>
              <SeriesMaterialRow material={material} />
            </li>
          );
        })}
      </ol>
      <DiscoveryContinuation result={result} />
    </section>
  );
}

function SeriesMaterialRow({ material }: { readonly material: MaterialPreview }) {
  const available = material.availability === "available";
  const AccessIcon = available ? Unlock : LockKeyhole;
  const accessLabel =
    material.availability === "locked"
      ? "Для участников"
      : material.availability === "unavailable"
        ? "Недоступно"
        : "Доступно";
  return (
    <article className="group/row relative grid min-h-32 gap-4 rounded-2xl bg-card p-5 shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover motion-reduce:transform-none motion-reduce:transition-none sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <span className="grid size-11 place-items-center rounded-xl bg-secondary text-accent">
        <BookOpenText aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] text-muted-foreground">
          <span>{material.format}</span>
          <span aria-hidden="true">·</span>
          <Link className="relative z-10 no-underline hover:text-foreground" href={`/topics/${material.topicSlug}`}>
            {material.topic}
          </Link>
        </span>
        <h3 className="mt-2 text-lg font-semibold leading-6 tracking-[-0.025em]">
          <Link className="no-underline after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring group-hover/row:underline group-hover/row:decoration-accent group-hover/row:underline-offset-4" href={`/materials/${material.slug}`} prefetch={false}>
            {material.title}
          </Link>
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">
          {material.summary}
        </p>
      </span>
      <span className="inline-flex min-h-8 w-fit shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs font-semibold sm:self-start">
        <AccessIcon aria-hidden="true" className="size-3.5" />
        {accessLabel}
      </span>
    </article>
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
        {kind === "series" ? "В плейлисте пока нет выпусков" : "В теме пока нет материалов"}
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
}: {
  readonly kind: LibraryDiscoveryKind;
  readonly name: string;
}) {
  return (
    <nav aria-label="Хлебные крошки">
      <ol className="flex min-h-10 flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
        <li>
          <Link
            className="inline-flex min-h-10 items-center rounded-lg px-2 no-underline hover:bg-muted hover:text-foreground focus-visible:outline-ring"
            href="/library"
          >
            База знаний
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>{kind === "series" ? "Плейлист" : "Тема"}</li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="max-w-[24ch] truncate text-foreground">
          {name}
        </li>
      </ol>
    </nav>
  );
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
