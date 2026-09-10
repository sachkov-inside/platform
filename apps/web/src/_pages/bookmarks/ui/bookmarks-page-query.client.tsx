"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { MaterialCard } from "@/entities/material";
import { listBookmarkPage } from "@/features/bookmarks";
import { Button } from "@/shared/ui/button";
import {
  BookmarksEmpty,
  BookmarksLoading,
  BookmarksSignInRequired,
  BookmarksUnavailable,
} from "./bookmarks-page";

export function BookmarksPageQuery() {
  const query = useInfiniteQuery({
    queryKey: ["bookmarks", "list"],
    queryFn: ({ pageParam }) => listBookmarkPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.kind === "ready" ? last.nextCursor ?? undefined : undefined,
    retry: false,
    staleTime: 0,
  });
  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);

  if (query.isPending) return <BookmarksLoading />;
  if (query.data === undefined) return <BookmarksUnavailable />;

  const first = pages[0];
  if (first === undefined || first.kind === "unavailable") return <BookmarksUnavailable />;
  if (first.kind === "unauthorized") return <BookmarksSignInRequired />;

  const items = pages.flatMap((page) => (page.kind === "ready" ? page.items : []));
  if (items.length === 0) return <BookmarksEmpty />;

  return (
    <>
      <ul className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2" role="list">
        {items.map((material) => (
          <li className="h-full min-w-0" key={material.slug}>
            <MaterialCard headingLevel="h3" material={material} variant="row" />
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="mt-6 flex justify-center">
          <Button
            aria-disabled={query.isFetchingNextPage}
            onClick={() => { void query.fetchNextPage(); }}
            type="button"
            variant="outline"
          >
            {query.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
