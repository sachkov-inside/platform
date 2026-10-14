"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { MaterialCard, useMaterialReading } from "@/entities/material";
import {
  BookmarkListReadError,
  bookmarkListQueryOptions,
  useBookmarkChanges,
} from "@/features/bookmarks";
import { Button } from "@/shared/ui/button";
import {
  BookmarksEmpty,
  BookmarksLoading,
  BookmarksSignInRequired,
  BookmarksUnavailable,
} from "./bookmarks-page";

export function BookmarksPageQuery() {
  const { accountId, resolved } = useMaterialReading();
  useBookmarkChanges(resolved ? accountId : null);
  const query = useInfiniteQuery({
    ...bookmarkListQueryOptions(accountId),
    enabled: resolved && accountId !== null,
  });
  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);

  if (!resolved) return <BookmarksLoading />;
  if (accountId === null) return <BookmarksSignInRequired />;
  if (query.isPending) return <BookmarksLoading />;

  if (
    query.error instanceof BookmarkListReadError &&
    query.error.kind === "unauthorized"
  )
    return <BookmarksSignInRequired />;

  if (query.data === undefined) return <BookmarksUnavailable />;

  const first = pages[0];
  if (first === undefined) return <BookmarksUnavailable />;

  const items = pages.flatMap((page) => page.items);
  if (items.length === 0 && !query.hasNextPage) return <BookmarksEmpty />;

  return (
    <>
      <ul
        className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2"
        role="list"
      >
        {items.map((material) => (
          <li className="h-full min-w-0" key={material.slug}>
            <MaterialCard headingLevel="h2" material={material} variant="row" />
          </li>
        ))}
      </ul>
      {query.isFetchNextPageError ? (
        <p className="mt-6 text-muted-foreground" role="alert">
          Не удалось загрузить следующие закладки. Повторите попытку.
        </p>
      ) : null}
      {query.hasNextPage ? (
        <div className="mt-6 flex justify-center">
          <Button
            aria-disabled={query.isFetchingNextPage}
            onClick={() => {
              if (query.isFetchingNextPage) return;
              void query.fetchNextPage();
            }}
            type="button"
            variant="outline"
          >
            {query.isFetchingNextPage
              ? "Загружаем…"
              : query.isFetchNextPageError
                ? "Повторить попытку"
                : "Показать ещё"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
