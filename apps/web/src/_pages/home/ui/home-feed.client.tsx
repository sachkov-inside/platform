"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  InfiniteMaterialCatalog, LibrarySearchControl, libraryCatalogQueryOptions,
  libraryHref, parseLibrarySearchParams, useLibraryCatalogQuery, withoutLibraryCursor,
  type LibrarySearchQuery, type LibraryCatalogQueryOptions,
} from "@/features/library-catalog";
import { Button } from "@/shared/ui/button";

const formats = [{ slug: null, label: "Все" }, { slug: "video", label: "Видео" }, { slug: "guide", label: "Гайды" }, { slug: "note", label: "Заметки" }] as const;

export function HomeFeed() {
  const search = useSearchParams().toString();
  const initialQuery = useMemo(() => withoutLibraryCursor(parseLibrarySearchParams(new URLSearchParams(search)).query), [search]);
  return <HomeFeedView initialQuery={initialQuery} createQueryOptions={libraryCatalogQueryOptions} syncLocation />;
}

export function HomeFeedView({ initialQuery, createQueryOptions, syncLocation = false }: {
  readonly syncLocation?: boolean;
  readonly initialQuery: LibrarySearchQuery;
  readonly createQueryOptions: (query: LibrarySearchQuery) => LibraryCatalogQueryOptions;
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
  const unavailable = catalog.query.isError && page === undefined || page?.kind === "unavailable";
  return <section className="home-feed" aria-labelledby="home-materials" id="materials">
    <h2 id="home-materials">Материалы</h2>
    <LibrarySearchControl query={catalog.searchQuery} onQueryChange={changeQuery} />
    <div className="home-feed-formats" role="group" aria-label="Формат материала">
      {formats.map(({ slug, label }) => <button key={slug ?? "all"} type="button" aria-pressed={(catalog.searchQuery.formatSlugs[0] ?? null) === slug} onClick={() => { changeQuery({ ...catalog.searchQuery, formatSlugs: slug === null ? [] : [slug], after: null }); }}>{label}</button>)}
    </div>
    <p className="home-feed-status" role="status">{catalog.query.isPending || catalog.query.isFetching && !catalog.query.isFetchingNextPage ? "Загружаем материалы…" : page?.kind === "ready" ? `Материалов: ${String(page.totalCount)}` : ""}</p>
    {catalog.query.isRefetchError && !catalog.query.isFetchNextPageError && page?.kind === "ready" ? <div role="alert" className="py-4"><p>Не удалось обновить ленту. Показаны ранее загруженные материалы.</p><Button variant="outline" className="mt-3" onClick={() => void catalog.query.refetch()}>Повторить обновление</Button></div> : null}
    {unavailable ? <div className="py-10"><p>Не удалось загрузить материалы.</p><Button className="mt-4" variant="outline" onClick={() => void catalog.query.refetch()}>Попробовать ещё раз</Button></div>
      : catalog.query.isPending ? <FeedSkeleton />
        : page?.kind === "empty" || page?.kind === "ready" && page.totalCount === 0 ? <p className="py-10 text-muted-foreground">{catalog.searchQuery.q || catalog.searchQuery.formatSlugs.length ? "Ничего не найдено. Измените запрос или выберите другой формат." : "Материалы скоро появятся."}</p>
          : page?.kind === "ready" ? <InfiniteMaterialCatalog presentation="feed" pages={catalog.readyPages} totalCount={page.totalCount} returnHref={libraryHref(catalog.requestQuery)} hasNextPage={catalog.query.hasNextPage} isFetchingNextPage={catalog.query.isFetchingNextPage} isFetchNextPageError={catalog.query.isFetchNextPageError} onLoadNextPage={catalog.loadNextPage} withoutHeading /> : null}
  </section>;
}

function FeedSkeleton() {
  return <div aria-hidden="true" className="space-y-8">{[0, 1].map((key) => <div className="h-64 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" key={key} />)}</div>;
}

export function HomeFeedLoading() {
  return <section className="home-feed" aria-busy="true" aria-label="Загружаем материалы"><h2>Материалы</h2><FeedSkeleton /></section>;
}

function replaceHomeQuery(query: LibrarySearchQuery) {
  const destination = new URL(libraryHref(query), window.location.origin);
  for (const value of new URLSearchParams(window.location.search).getAll("authentication")) destination.searchParams.append("authentication", value);
  const href = `${destination.pathname}${destination.search}`;
  if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
}
