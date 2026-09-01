import {
  ArrowLeft,
  LibraryBig,
  ListVideo,
  RefreshCw,
  SearchX,
  ShieldAlert,
  Tags,
} from "lucide-react";
import Link from "next/link";

import type {
  LibraryDiscoveryKind,
  LibraryDiscoveryResult,
} from "@/_pages/library-discovery/model/library-discovery-view";
import { MaterialCard, type MaterialPreview } from "@/entities/material";
import { Button } from "@/shared/ui/button";

type ResolvedDiscoveryResult = Exclude<
  LibraryDiscoveryResult,
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
        <h1 className="relative mt-2 max-w-[24ch] text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-4xl @min-[64rem]/discovery:text-5xl">
          {result.reference.name}
        </h1>
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
  const series = uniqueSeries(result.items);

  return (
    <>
      {series.length > 0 ? (
        <nav aria-label="Плейлисты темы" className="mt-8 sm:mt-10">
          <p className="text-sm font-semibold">Плейлисты в теме</p>
          <ul className="mt-3 flex flex-wrap gap-2" role="list">
            {series.map((item) => (
              <li key={item.slug}>
                <Link
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm font-semibold no-underline hover:bg-secondary focus-visible:outline-ring"
                  href={`/series/${item.slug}`}
                  prefetch={false}
                >
                  <ListVideo aria-hidden="true" className="size-4 text-accent" />
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <section aria-labelledby="topic-materials" className="mt-8 sm:mt-10">
        <h2 className="text-xl font-semibold tracking-[-0.025em]" id="topic-materials">
          Материалы
        </h2>
        <MaterialGrid items={result.items} />
        <DiscoveryContinuation result={result} />
      </section>
    </>
  );
}

function SeriesMaterials({
  result,
}: {
  readonly result: Extract<ResolvedDiscoveryResult, { readonly kind: "ready" }>;
}) {
  const topics = uniqueTopics(result.items);

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
              <MaterialCard headingLevel="h3" material={material} />
            </li>
          );
        })}
      </ol>
      <DiscoveryContinuation result={result} />
    </section>
  );
}

function MaterialGrid({ items }: { readonly items: readonly MaterialPreview[] }) {
  return (
    <ul
      className="mt-5 grid grid-cols-1 items-stretch justify-items-center gap-4 @min-[40rem]/discovery:grid-cols-2 @min-[68rem]/discovery:grid-cols-3"
      role="list"
    >
      {items.map((material) => (
        <li className="h-full w-full max-w-[28rem]" key={material.slug}>
          <MaterialCard headingLevel="h3" material={material} />
        </li>
      ))}
    </ul>
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
        <Link href="/library">Открыть Библиотеку</Link>
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
            Библиотека
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
            В Библиотеку
          </Link>
        </Button>
      }
      icon={<SearchX aria-hidden="true" />}
      message="Проверьте адрес или выберите другую тему или плейлист в Библиотеке."
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

function uniqueSeries(items: readonly MaterialPreview[]) {
  return uniqueBySlug(
    items.flatMap((material) => material.seriesMemberships),
  );
}

function uniqueTopics(items: readonly MaterialPreview[]) {
  return uniqueBySlug(
    items.map((material) => ({ name: material.topic, slug: material.topicSlug })),
  );
}

function uniqueBySlug<T extends { readonly name: string; readonly slug: string }>(
  items: readonly T[],
): readonly T[] {
  return [...new Map(items.map((item) => [item.slug, item])).values()];
}

function formatMaterialCount(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14
      ? "материалов"
      : mod10 === 1
        ? "материал"
        : mod10 >= 2 && mod10 <= 4
          ? "материала"
          : "материалов";

  return `${String(count)} ${noun}`;
}
