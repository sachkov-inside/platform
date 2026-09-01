"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  formatFoundMaterialCount,
  formatLoadedMaterialCount,
} from "../model/format-material-count";
import type { LibraryCatalogPage } from "../model/library-view";
import { Button } from "@/shared/ui/button";
import { LibraryMaterialGrid } from "./library-page";

type ReadyLibraryCatalogPage = Extract<
  LibraryCatalogPage,
  { readonly kind: "ready" }
>;

export function InfiniteLibraryCatalog({
  hasNextPage,
  isFetchNextPageError,
  isFetchingNextPage,
  onLoadNextPage,
  pages,
  totalCount,
}: {
  readonly hasNextPage: boolean;
  readonly isFetchNextPageError: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onLoadNextPage: () => void;
  readonly pages: readonly ReadyLibraryCatalogPage[];
  readonly totalCount: number;
}) {
  const loadSentinelRef = useRef<HTMLDivElement>(null);
  const materialCount = pages.reduce(
    (count, page) => count + page.items.length,
    0,
  );

  useEffect(() => {
    const sentinel = loadSentinelRef.current;
    if (
      sentinel === null ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadNextPage();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    onLoadNextPage,
  ]);

  return (
    <section
      aria-labelledby="materials-heading"
      className="mt-8 sm:mt-10"
      data-library-state="ready"
    >
      <div>
        <h2
          className="text-lg font-semibold tracking-[-0.025em] @min-[30rem]/library:text-xl"
          id="materials-heading"
        >
          Материалы
        </h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {formatFoundMaterialCount(totalCount)} ·{" "}
          {formatLoadedMaterialCount(materialCount)}
        </p>
      </div>

      {pages.map((page, pageIndex) => (
        <LibraryMaterialGrid
          className="mt-4"
          items={page.items}
          key={page.items[0]?.slug ?? `catalog-page-${String(pageIndex + 1)}`}
          label={`Материалы, страница ${String(pageIndex + 1)}`}
        />
      ))}

      <div aria-hidden="true" className="h-px" ref={loadSentinelRef} />
      <div aria-live="polite" className="mt-6 flex min-h-11 justify-center">
        {isFetchingNextPage ? (
          <p className="text-sm text-muted-foreground">Загружаем ещё материалы…</p>
        ) : null}
        {isFetchNextPageError ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Не удалось загрузить продолжение каталога.
            </p>
            <Button onClick={onLoadNextPage} size="sm" variant="outline">
              <RefreshCw aria-hidden="true" />
              Повторить
            </Button>
          </div>
        ) : null}
        {hasNextPage && !isFetchingNextPage && !isFetchNextPageError ? (
          <Button onClick={onLoadNextPage} size="sm" variant="outline">
            Показать ещё
          </Button>
        ) : null}
        {!hasNextPage && !isFetchNextPageError ? (
          <p className="text-sm text-muted-foreground">Все материалы загружены</p>
        ) : null}
      </div>
    </section>
  );
}
