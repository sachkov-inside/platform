"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  PaymentLinksPanel,
  type PaymentLinksFilter,
} from "@/features/payment-links";
import { authoringPaymentLinksHref } from "@/shared/routing/authoring";

import {
  parseSalesLinksQuery,
  salesLinksHref,
} from "../model/sales-links-query";
import { SalesLinksFrame } from "./sales-links-frame";

/**
 * «Ссылки на оплату» в разделе «Продажи»: фильтр продукта и состояния живёт в адресе, каждый
 * выбор становится записью истории, поэтому «назад» возвращает прежний фильтр.
 */
export function SalesLinksPageQuery() {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const filter = useMemo(
    () => parseSalesLinksQuery(new URLSearchParams(search)),
    [search],
  );
  const changeFilter = useCallback((next: PaymentLinksFilter) => {
    // Скрытая, но смонтированная прежняя страница (ADR 0027) не пишет чужой адрес.
    if (window.location.pathname !== authoringPaymentLinksHref) return;
    const href = salesLinksHref(next);
    if (`${window.location.pathname}${window.location.search}` === href) return;
    window.history.pushState(null, "", href);
  }, []);
  return (
    <SalesLinksFrame>
      <PaymentLinksPanel filter={filter} onFilterChange={changeFilter} />
    </SalesLinksFrame>
  );
}
