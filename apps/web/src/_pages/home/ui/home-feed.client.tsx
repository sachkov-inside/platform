"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import {
  InfiniteMaterialCatalog,
  LibrarySearchControl,
  homeFeedQueryOptions,
  libraryHref,
  parseLibrarySearchParams,
  useLibraryCatalogQuery,
  withoutLibraryCursor,
  type LibrarySearchQuery,
  type LibraryCatalogQueryOptions,
} from "@/features/library-catalog";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

const formats = [
  { slug: null, label: "Все" },
  { slug: "video", label: "Видео" },
  { slug: "guide", label: "Гайды" },
  { slug: "note", label: "Заметки" },
] as const;

export function HomeFeed() {
  const search = useSearchParams().toString();
  const initialQuery = useMemo(
    () =>
      withoutLibraryCursor(
        parseLibrarySearchParams(new URLSearchParams(search)).query,
      ),
    [search],
  );
  return (
    <HomeFeedView
      initialQuery={initialQuery}
      createQueryOptions={homeFeedQueryOptions}
      syncLocation
    />
  );
}

export function HomeFeedView({
  initialQuery,
  createQueryOptions,
  syncLocation = false,
}: {
  readonly syncLocation?: boolean;
  readonly initialQuery: LibrarySearchQuery;
  readonly createQueryOptions: (
    query: LibrarySearchQuery,
  ) => LibraryCatalogQueryOptions;
}) {
  const catalog = useLibraryCatalogQuery({ initialQuery, createQueryOptions });
  useEffect(() => {
    if (syncLocation) replaceHomeQuery(initialQuery);
  }, [initialQuery, syncLocation]);
  const changeQuery = (next: LibrarySearchQuery) => {
    catalog.changeQuery(next);
    if (syncLocation) replaceHomeQuery(next);
  };
  const page = catalog.firstPage;
  const unavailable =
    (catalog.query.isError && page === undefined) ||
    page?.kind === "unavailable";
  return (
    <section className="home-feed" aria-label="Материалы" id="materials">
      <div className="home-feed-toolbar">
        <LibrarySearchControl
          query={catalog.searchQuery}
          onQueryChange={changeQuery}
        />
        <FeedFilters
          query={catalog.searchQuery}
          topics={page?.kind === "ready" ? page.facets.topics : []}
          onQueryChange={changeQuery}
        />
      </div>
      <p className="sr-only" role="status">
        {catalog.query.isPending ||
        (catalog.query.isFetching && !catalog.query.isFetchingNextPage)
          ? "Загружаем материалы…"
          : page?.kind === "ready"
            ? `Материалов: ${String(page.totalCount)}`
            : ""}
      </p>
      {catalog.query.isRefetchError &&
      !catalog.query.isFetchNextPageError &&
      page?.kind === "ready" ? (
        <div role="alert" className="py-4">
          <p>
            Не удалось обновить ленту. Показаны ранее загруженные материалы.
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void catalog.query.refetch()}
          >
            Повторить обновление
          </Button>
        </div>
      ) : null}
      {unavailable ? (
        <div className="py-10">
          <p>Не удалось загрузить материалы.</p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => void catalog.query.refetch()}
          >
            Попробовать ещё раз
          </Button>
        </div>
      ) : catalog.query.isPending ? (
        <FeedSkeleton />
      ) : page?.kind === "empty" ||
        (page?.kind === "ready" && page.totalCount === 0) ? (
        <p className="py-10 text-muted-foreground">
          {catalog.searchQuery.q ||
          catalog.searchQuery.formatSlugs.length ||
          catalog.searchQuery.topicSlug !== null
            ? "Ничего не найдено. Измените запрос, тему или формат."
            : "Материалы скоро появятся."}
        </p>
      ) : page?.kind === "ready" ? (
        <InfiniteMaterialCatalog
          presentation="feed"
          pages={catalog.readyPages}
          totalCount={page.totalCount}
          returnHref={libraryHref(catalog.requestQuery)}
          hasNextPage={catalog.query.hasNextPage}
          isFetchingNextPage={catalog.query.isFetchingNextPage}
          isFetchNextPageError={catalog.query.isFetchNextPageError}
          onLoadNextPage={catalog.loadNextPage}
          withoutHeading
        />
      ) : null}
    </section>
  );
}

/** Above this many topics the chip row folds them into one menu of the same shape. */
const inlineTopicLimit = 6;

/** Formats and topics share one chip language; a second press on a topic clears it. */
function FeedFilters({
  query,
  topics,
  onQueryChange,
}: {
  readonly query: LibrarySearchQuery;
  readonly topics: readonly {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  }[];
  readonly onQueryChange: (query: LibrarySearchQuery) => void;
}) {
  const format = query.formatSlugs[0] ?? null;
  // Search text has its own clear control; the reset clears the chip filters only.
  const filtered = format !== null || query.topicSlug !== null;
  const allFormats = useRef<HTMLButtonElement>(null);
  const chooseTopic = (slug: string | null) => {
    onQueryChange({ ...query, topicSlug: slug, after: null });
  };
  return (
    <div className="home-feed-filters">
      <div
        className="home-feed-chips"
        role="group"
        aria-label="Формат материала"
      >
        {formats.map(({ slug, label }) => (
          <button
            key={slug ?? "all"}
            ref={slug === null ? allFormats : undefined}
            type="button"
            aria-pressed={format === slug}
            onClick={() => {
              onQueryChange({
                ...query,
                formatSlugs: slug === null ? [] : [slug],
                after: null,
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {topics.length === 0 ? null : (
        <>
          <span aria-hidden="true" className="home-feed-divider" />
          {topics.length > inlineTopicLimit ? (
            <Select
              value={query.topicSlug ?? "all"}
              onValueChange={(value) => {
                chooseTopic(value === "all" ? null : value);
              }}
            >
              <SelectTrigger
                aria-label="Тема"
                className="home-feed-topic-menu"
                data-active={query.topicSlug !== null}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все темы</SelectItem>
                {topics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.slug}>
                    {topic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="home-feed-chips" role="group" aria-label="Тема">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  aria-pressed={query.topicSlug === topic.slug}
                  onClick={() => {
                    chooseTopic(
                      query.topicSlug === topic.slug ? null : topic.slug,
                    );
                  }}
                >
                  {topic.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {filtered ? (
        <button
          type="button"
          className="home-feed-reset"
          onClick={() => {
            onQueryChange({
              ...query,
              formatSlugs: [],
              topicSlug: null,
              after: null,
            });
            allFormats.current?.focus();
          }}
        >
          Сбросить
        </button>
      ) : null}
    </div>
  );
}

const skeletonBlock = "animate-pulse bg-muted motion-reduce:animate-none";

/** Строки скелета повторяют разметку поста ленты: разделитель, автор, заголовок, текст и обложку. */
function FeedSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1].map((key) => (
        <div className="home-feed-post" key={key}>
          <div className="flex items-center gap-3">
            <span
              className={`size-10 shrink-0 rounded-full ${skeletonBlock}`}
            />
            <span className={`h-4 w-32 rounded ${skeletonBlock}`} />
          </div>
          <div className={`mt-4 h-6 w-3/4 rounded ${skeletonBlock}`} />
          <div className={`mt-3 h-12 rounded ${skeletonBlock}`} />
          <div className="home-feed-artwork">
            <div
              className={`aspect-video w-full rounded-xl ${skeletonBlock}`}
            />
          </div>
          <div className="mt-4 min-h-11" />
        </div>
      ))}
    </div>
  );
}

/** Лента до готовности своей границы Suspense: та же панель и те же строки, что у ожидающей ленты. */
export function HomeFeedLoading() {
  return (
    <section className="home-feed" aria-busy="true" aria-label="Материалы">
      <div className="home-feed-toolbar" aria-hidden="true" />
      <p className="sr-only" role="status">
        Загружаем материалы…
      </p>
      <FeedSkeleton />
    </section>
  );
}

function replaceHomeQuery(query: LibrarySearchQuery) {
  const destination = new URL(libraryHref(query), window.location.origin);
  for (const value of new URLSearchParams(window.location.search).getAll(
    "authentication",
  ))
    destination.searchParams.append("authentication", value);
  const href = `${destination.pathname}${destination.search}`;
  if (`${window.location.pathname}${window.location.search}` !== href)
    window.history.replaceState(null, "", href);
}
