"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  InfiniteMaterialCatalog,
  homeFeedQueryOptions,
  libraryHref,
  parseLibrarySearchParams,
  useLibraryCatalogQuery,
  withoutLibraryCursor,
  type LibrarySearchQuery,
  type LibraryCatalogQueryOptions,
} from "@/features/library-catalog";
import { Button } from "@/shared/ui/button";
export function HomeFeed() {
  const search = useSearchParams().toString();
  // Поиска на Главной нет (решение владельца 09.10.2026): текст запроса из старой ссылки
  // `/?q=…` не применяется, иначе лента сузилась бы без видимой причины. Синхронизация адреса
  // ниже убирает его из адреса.
  const initialQuery = useMemo(() => {
    const query = withoutLibraryCursor(
      parseLibrarySearchParams(new URLSearchParams(search)).query,
    );
    return {
      ...query,
      q: "",
      formatSlugs: [],
      sort: query.sort === "relevance" ? ("newest" as const) : query.sort,
    };
  }, [search]);
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
  const topicQuery = useMemo(
    () => ({ ...initialQuery, formatSlugs: [] }),
    [initialQuery],
  );
  const catalog = useLibraryCatalogQuery({
    initialQuery: topicQuery,
    createQueryOptions,
  });
  useEffect(() => {
    if (syncLocation) replaceHomeQuery(topicQuery);
  }, [topicQuery, syncLocation]);
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
      {/* Поиска по материалам на Главной пока нет (решение владельца 09.10.2026): лента и
          фильтры по темам. Поиск и форматы остаются в каталоге. */}
      <div className="home-feed-toolbar">
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
          {catalog.searchQuery.topicSlug !== null
            ? "По этой теме пока нет материалов."
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

/** The public library is filtered by topic; pressing the selected topic clears it. */
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
  const chooseTopic = (slug: string | null) => {
    onQueryChange({ ...query, formatSlugs: [], topicSlug: slug, after: null });
  };
  return (
    <div className="home-feed-filters">
      <div className="home-feed-chips" role="group" aria-label="Тема">
        <button
          type="button"
          aria-pressed={query.topicSlug === null}
          onClick={() => {
            chooseTopic(null);
          }}
        >
          Все
        </button>
        {topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            aria-pressed={query.topicSlug === topic.slug}
            onClick={() => {
              chooseTopic(query.topicSlug === topic.slug ? null : topic.slug);
            }}
          >
            {topic.name}
          </button>
        ))}
      </div>
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
        </div>
      ))}
    </div>
  );
}

/** Лента до готовности своей границы Suspense: та же панель и те же строки, что у ожидающей ленты. */
export function HomeFeedLoading() {
  return (
    <section className="home-feed" aria-busy="true" aria-label="Материалы">
      <div className="home-feed-toolbar" aria-hidden="true">
        <div className="home-feed-filters">
          {["w-14", "w-24"].map((width, index) => (
            <div
              key={index}
              className={`h-9 shrink-0 rounded-full sm:h-11 ${width} ${skeletonBlock}`}
            />
          ))}
        </div>
      </div>
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
