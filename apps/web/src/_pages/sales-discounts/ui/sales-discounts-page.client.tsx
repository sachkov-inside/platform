"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { PromotionsPanel, type PromotionsFilter } from "@/features/promotions";

import {
  parseSalesDiscountsQuery,
  salesDiscountsHref,
  salesDiscountsRootHref,
} from "../model/sales-discounts-query";
import { SalesDiscountsFrame } from "./sales-discounts-frame";

/** «Скидки» в разделе «Продажи»: подраздел и фильтр в адресе, каждый выбор отдельной записью истории. */
export function SalesDiscountsPageQuery() {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const filter = useMemo(
    () => parseSalesDiscountsQuery(new URLSearchParams(search)),
    [search],
  );
  const changeFilter = useCallback((next: PromotionsFilter) => {
    // Скрытая, но смонтированная прежняя страница (ADR 0027) не пишет чужой адрес.
    if (window.location.pathname !== salesDiscountsRootHref) return;
    const href = salesDiscountsHref(next);
    if (`${window.location.pathname}${window.location.search}` === href) return;
    window.history.pushState(null, "", href);
  }, []);
  return (
    <SalesDiscountsFrame>
      <PromotionsPanel filter={filter} onFilterChange={changeFilter} />
    </SalesDiscountsFrame>
  );
}
