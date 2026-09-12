import {
  ArrowLeft,
  LibraryBig,
  RefreshCw,
  SearchX,
  ShieldAlert,
  Tags,
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
} from "@/entities/material";
import { PlaylistCard, formatMaterialCount } from "@/features/library-discovery";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { PublicSectionHeading } from "@/shared/ui/public-section-heading";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";
import {
  collectionDiscoveryHref,
  libraryMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { GuideProductView } from "./guide-product-view";
import { TopicMaterialCatalog } from "./topic-material-catalog.client";

type ResolvedDiscoveryResult = Exclude<
  PublishedSeriesResult | PublishedTopicResult,
  { readonly kind: "not-found" | "unavailable" }
>;
type PublishedTopicResultResolved = Exclude<
  PublishedTopicResult,
  { readonly kind: "not-found" | "unavailable" }
>;

/**
 * Развилка двух разных страниц. Руководство уходит на свою страницу продукта: она рассказывает —
 * обложка, авторские ответы на четыре вопроса, программа обзором и артефакты как обещание
 * результата, — а материалы, состояния доступа и приглашение к оплате живут в программе.
 * Тема остаётся прежней страницей со своим заголовком и списком материалов.
 */
export function LibraryDiscoveryView({
  artifacts = { kind: "ready", artifacts: [] },
  result,
  returnTarget = libraryMaterialReaderReturnTarget,
}: {
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: ResolvedDiscoveryResult;
  readonly returnTarget?: MaterialReaderReturnTarget;
}) {
  if (result.discoveryKind === "series") {
    const entry = freeEntryHref(result);
    return (
      <GuideProductView
        artifacts={artifacts}
        result={result}
        returnTarget={returnTarget}
        {...(entry === undefined ? {} : { freeEntryHref: entry })}
      />
    );
  }
  const currentHref = collectionDiscoveryHref(
    result.discoveryKind,
    result.reference.slug,
    returnTarget.href,
  );

  return (
    <DiscoveryFrame kind={result.discoveryKind} state={result.kind}>
      <DiscoveryBreadcrumb
        kind={result.discoveryKind}
        name={result.reference.name}
        returnTarget={returnTarget}
      />
      <DiscoveryHero result={result} />

      {result.kind === "empty" ? (
        <DiscoveryEmpty kind={result.discoveryKind} />
      ) : (
        <TopicMaterials currentHref={currentHref} result={result} />
      )}
    </DiscoveryFrame>
  );
}

/**
 * Каркас подборки. Готовый вид и его загрузка берут оболочку отсюда: пока каждый описывал её сам,
 * у загрузки был другой размер и другое имя контейнера, поэтому первый экран прыгал, а контейнерные
 * запросы внутри считали не от той ширины.
 */
function DiscoveryFrame({
  busy = false,
  children,
  kind,
  label,
  state,
}: {
  readonly busy?: boolean;
  readonly children: React.ReactNode;
  readonly kind?: LibraryDiscoveryKind;
  readonly label?: string;
  readonly state: PublishedTopicResultResolved["kind"] | "loading";
}) {
  return (
    <div
      aria-busy={busy || undefined}
      aria-label={label}
      className="@container/discovery min-w-0"
      data-discovery-frame
      data-discovery-kind={kind}
      data-discovery-state={state}
    >
      {children}
    </div>
  );
}

/** Заголовок темы: руководство сюда не попадает — у него своя страница продукта. */
function DiscoveryHero({ result }: { readonly result: PublishedTopicResultResolved }) {
  return (
    <header
      className={cn(
        `${heroTopMargin} overflow-hidden rounded-[2rem] p-6 md:p-10`,
        discoveryToneClass(result.reference.slug),
        "text-foreground",
      )}
    >
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-body-muted">Тема</p>
          <h1 className="mt-3 max-w-3xl break-words text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.035em] md:text-4xl">
            {result.reference.name}
          </h1>
          {result.reference.summary ? (
            <p className="mt-4 max-w-2xl text-base leading-7 text-body-muted md:text-lg">
              {result.reference.summary}
            </p>
          ) : null}
        </div>
        {result.reference.cover !== null && result.reference.cover !== undefined ? (
          <ContentCoverImage
            alt=""
            className="size-24 shrink-0 rotate-[-5deg] rounded-[1.6rem] shadow-xl md:size-32"
            cover={result.reference.cover}
            fallbackKind="topic"
            fallbackSeed={result.reference.slug}
            sizes="8rem"
          />
        ) : (
          <span className="grid size-24 shrink-0 rotate-[-5deg] place-items-center rounded-[1.6rem] border border-white/45 bg-white/75 text-foreground shadow-xl backdrop-blur-sm md:size-32">
            <Tags aria-hidden="true" className="size-12 md:size-16" strokeWidth={1.6} />
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
          title="Руководства"
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
            Связанных руководств пока нет
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

function DiscoveryEmpty({ kind }: { readonly kind: LibraryDiscoveryKind }) {
  return (
    <section className="mt-8 max-w-[48rem] rounded-2xl bg-muted px-6 py-7 sm:mt-10 sm:px-8">
      <LibraryBig aria-hidden="true" className="size-6 text-accent" />
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
        {kind === "series" ? "В руководстве пока нет материалов" : "В теме пока нет материалов"}
      </h2>
      <Button asChild className="mt-6" size="lg" variant="outline">
        <Link href="/library">Открыть Базу знаний</Link>
      </Button>
    </section>
  );
}

/** Ряд хлебных крошек и верхний отступ шапки: их же занимает состояние загрузки. */
const breadcrumbRow = "mt-7";
const breadcrumbRowHeight = "min-h-10";
const heroTopMargin = "mt-5";

/** Место хлебных крошек, пока данных нет: тот же ряд, только без ссылки. */
function DiscoveryBreadcrumbPlaceholder() {
  return (
    <div aria-hidden="true" className={`${breadcrumbRow} ${breadcrumbRowHeight}`}>
      <div className="h-10 w-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
    </div>
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
    <nav aria-label="Хлебные крошки" className={breadcrumbRow}>
      <ol className={`flex ${breadcrumbRowHeight} flex-wrap items-center gap-2 text-sm text-muted-foreground`}>
        <li>
          <Link
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-muted px-4 font-semibold no-underline hover:text-foreground focus-visible:outline-ring"
            href={returnTarget.href}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {returnTarget.label}
          </Link>
        </li>
        <li className="sr-only">{kind === "series" ? "Руководство" : "Тема"}</li>
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
        <span className="text-sm font-semibold text-muted-foreground">{count}</span>
      }
      className="mt-11"
      id={id}
      title={title}
    />
  );
}

function discoveryToneClass(seed: string): string {
  const tones = [
    "bg-cover-blue",
    "bg-cover-coral",
    "bg-cover-lavender",
    "bg-cover-mint",
    "bg-cover-sand",
  ] as const;
  const value = Array.from(seed).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0,
    0,
  );
  return tones[value % tones.length] ?? tones[0];
}

/**
 * Первый экран подборки, пока данные ещё идут. Оболочку состояние берёт оттуда же, откуда готовый
 * вид; своего у него — только серые блоки внутри.
 */
export function LibraryDiscoveryLoading() {
  return (
    <DiscoveryFrame busy label="Подборка загружается" state="loading">
      <DiscoveryBreadcrumbPlaceholder />
      <div className={`${heroTopMargin} animate-pulse rounded-2xl bg-secondary px-6 py-8 motion-reduce:animate-none sm:px-8`}>
        <div className="size-11 rounded-xl bg-muted" />
        <div className="mt-6 h-10 w-3/4 rounded-xl bg-muted" />
        <div className="mt-4 h-5 w-full max-w-xl rounded-lg bg-muted/80" />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="h-52 rounded-xl bg-muted" />
        <div className="h-52 rounded-xl bg-muted" />
      </div>
      <p className="sr-only">Загружаем опубликованные материалы</p>
    </DiscoveryFrame>
  );
}

/**
 * Сбой чтения подборки. Повтор возвращает человека ровно на ту страницу, где он стоял:
 * страница продукта, программа и тема — разные места, и подмена одной другой теряет его шаг.
 */
export function LibraryDiscoveryUnavailable({
  retryHref,
}: {
  readonly retryHref: Route;
}) {
  return (
    <DiscoveryStatus
      action={
        <Button asChild size="lg">
          <Link href={retryHref}>
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
      message="Проверьте адрес или выберите другую тему или руководство в Базе знаний."
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


/**
 * Бесплатный вход из обложки ведёт в программу: там читатель сразу видит открытые уроки и то,
 * что за ними. Кнопка появляется, только когда открытый материал действительно есть.
 */
function freeEntryHref(result: ResolvedDiscoveryResult): Route | undefined {
  if (result.kind !== "ready") return undefined;
  return result.items.some((item) => item.availability === "available")
    ? guideProgrammeHref(result.reference.slug)
    : undefined;
}
