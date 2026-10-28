"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  parseProductPageTab,
  productPageTabSearch,
  type ProductPageTabId,
} from "./product-page-tabs";

/**
 * Вкладка страницы продукта живёт в адресе `?tab=`. Выбор добавляет запись истории, поэтому
 * «назад» возвращает прежнюю вкладку; вкладка из адреса побеждает выбор, сделанный до него.
 * Пока страница скрыта за другим адресом (ADR 0027), чужой адрес вкладку не меняет.
 */
export function useProductPageTab(): readonly [
  ProductPageTabId,
  (tab: ProductPageTabId) => void,
] {
  const pathname = usePathname();
  const [ownPath] = useState(pathname);
  const urlTab = parseProductPageTab(useSearchParams().get("tab"));
  const [state, setState] = useState({ urlTab, selected: urlTab });
  useEffect(() => {
    // Next may coalesce pushState and a quick Back before urlTab changes.
    const restore = () => {
      if (window.location.pathname !== ownPath) return;
      const tab = parseProductPageTab(
        new URLSearchParams(window.location.search).get("tab"),
      );
      setState({ urlTab: tab, selected: tab });
    };
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
    };
  }, [ownPath]);
  let selected = state.selected;
  if (pathname === ownPath && state.urlTab !== urlTab) {
    selected = urlTab;
    setState({ urlTab, selected: urlTab });
  }
  const select = (tab: ProductPageTabId) => {
    setState((previous) => ({ ...previous, selected: tab }));
    if (window.location.pathname !== ownPath) return;
    const search = productPageTabSearch(window.location.search, tab);
    if (search === window.location.search) return;
    window.history.pushState(null, "", `${ownPath}${search}`);
  };
  return [selected, select];
}
