"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  PaymentsTable,
  parsePaymentsSearchParams,
  salesPaymentsQueryHref,
  type PaymentsQuery,
} from "@/features/owner-payments";
import { authoringPaymentsHref } from "@/shared/routing/authoring";

import { SalesPaymentsFrame } from "./sales-payments-frame";

/** Страница «Платежи»: выбор живёт в адресе, список читает браузер (ADR 0027). */
export function SalesPaymentsPageQuery() {
  const searchParams = useSearchParams();
  const locationSearch = searchParams.toString();
  const query = useMemo(
    () => parsePaymentsSearchParams(new URLSearchParams(locationSearch)),
    [locationSearch],
  );
  const changeQuery = useCallback((next: PaymentsQuery) => {
    writePaymentsUrl(next);
  }, []);
  return (
    <SalesPaymentsFrame>
      <PaymentsTable onQueryChange={changeQuery} query={query} />
    </SalesPaymentsFrame>
  );
}

/**
 * Каждый выбор фильтра или страницы — новая запись истории, поэтому «назад» возвращает прежний
 * срез. Next держит посещённый список скрытым, пока открыта другая страница (ADR 0027): адрес
 * меняет только список, который сейчас открыт.
 */
function writePaymentsUrl(next: PaymentsQuery): void {
  if (window.location.pathname !== authoringPaymentsHref) return;
  const href = salesPaymentsQueryHref(next);
  if (`${window.location.pathname}${window.location.search}` === href) return;
  window.history.pushState(null, "", href);
}
