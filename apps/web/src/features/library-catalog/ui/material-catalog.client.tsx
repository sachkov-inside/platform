"use client";

import { RefreshCw } from "lucide-react";
import type { Route } from "next";
import { useEffect, useRef } from "react";

import { MaterialCard } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import {
  formatFoundMaterialCount,
  formatLoadedMaterialCount,
} from "../model/format-material-count";
import type { LibraryCatalogPage } from "../model/library-view";

type ReadyLibraryCatalogPage = Extract<
  LibraryCatalogPage,
  { readonly kind: "ready" }
>;

export function InfiniteMaterialCatalog({
  hasNextPage,
  isFetchNextPageError,
  isFetchingNextPage,
  onLoadNextPage,
  pages,
  returnHref,
  totalCount,
}: {
  readonly hasNextPage: boolean;
  readonly isFetchNextPageError: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onLoadNextPage: () => void;
  readonly pages: readonly ReadyLibraryCatalogPage[];
  readonly returnHref?: Route;
  readonly totalCount: number;
}) {
  const loadSentinelRef = useRef<HTMLDivElement>(null);
  const materialCount = pages.reduce((count, page) => count + page.items.length, 0);

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
        if (entries.some((entry) => entry.isIntersecting)) onLoadNextPage();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchNextPageError, isFetchingNextPage, onLoadNextPage]);

  return (
    <section aria-labelledby="materials-heading" className="mt-8 sm:mt-10" data-library-state="ready">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.025em] @min-[30rem]/library:text-xl" id="materials-heading">
          Материалы
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatFoundMaterialCount(totalCount)} · {formatLoadedMaterialCount(materialCount)}
        </p>
      </div>
      {pages.map((page, pageIndex) => (
        <MaterialCatalogGrid
          className="mt-4"
          items={page.items}
          key={page.items[0]?.slug ?? `catalog-page-${String(pageIndex + 1)}`}
          label={`Материалы, страница ${String(pageIndex + 1)}`}
          {...(returnHref === undefined ? {} : { returnHref })}
        />
      ))}
      <div aria-hidden="true" className="h-px" ref={loadSentinelRef} />
      <div aria-live="polite" className="mt-6 flex min-h-11 justify-center">
        {isFetchingNextPage ? (
          <p className="text-sm text-muted-foreground">Загружаем ещё материалы…</p>
        ) : null}
        {isFetchNextPageError ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">Не удалось загрузить продолжение каталога.</p>
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

export function MaterialCatalogGrid({
  className = "",
  items,
  label,
  returnHref,
}: {
  readonly className?: string;
  readonly items: ReadyLibraryCatalogPage["items"];
  readonly label?: string;
  readonly returnHref?: Route;
}) {
  return (
    <ul
      {...(label === undefined ? {} : { "aria-label": label })}
      className={`${className} grid grid-cols-1 items-stretch justify-items-center gap-4 @min-[40rem]/library:grid-cols-2 @min-[68rem]/library:grid-cols-3`}
      data-material-grid
      role="list"
    >
      {items.map((material) => (
        <li className="h-full w-full max-w-[28rem]" key={material.slug}>
          <MaterialCard
            headingLevel="h3"
            material={material}
            {...(returnHref === undefined ? {} : { returnHref })}
          />
        </li>
      ))}
    </ul>
  );
}
