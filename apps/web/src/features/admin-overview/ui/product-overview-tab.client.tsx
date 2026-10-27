"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { OverviewPeriodDays } from "../model/overview-contract";
import {
  productOverviewPeriodSearch,
  readProductOverviewPeriod,
} from "../model/product-overview";
import { productOverviewQueryOptions } from "../model/product-overview-query-options";
import { ProductOverviewPanel } from "./product-overview-panel.client";

/**
 * Вкладка «Обзор» страницы продукта. Период живет в адресе страницы (`?period=7|90`) рядом с
 * вкладкой; выбор добавляет запись истории, поэтому «назад» возвращает прежний период. Страница
 * монтирует вкладку при первом открытии, поэтому другие вкладки этого чтения не просят.
 */
export function ProductOverviewTab({
  productId,
  programHref,
}: {
  readonly productId: string;
  readonly programHref: Route;
}) {
  const pathname = usePathname();
  const [ownPath] = useState(pathname);
  const period = readProductOverviewPeriod(useSearchParams());
  const overview = useQuery({
    ...productOverviewQueryOptions(productId, period),
    placeholderData: keepPreviousData,
  });

  const changePeriod = (next: OverviewPeriodDays) => {
    // Ушедшая страница остается скрытой (ADR 0027); адрес переписывает только открытая.
    if (window.location.pathname !== ownPath) return;
    const search = productOverviewPeriodSearch(window.location.search, next);
    if (search === window.location.search) return;
    window.history.pushState(null, "", `${ownPath}${search}`);
  };

  return (
    <ProductOverviewPanel
      onPeriodChange={changePeriod}
      onRetry={() => {
        void overview.refetch();
      }}
      period={period}
      programHref={programHref}
      refreshing={overview.isPlaceholderData}
      state={overview.data ?? { kind: "loading" }}
    />
  );
}
