"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { ContentCollectionKind } from "./content-collections";
import {
  parseCollectionListQuery,
  serializeCollectionListQuery,
  type CollectionListQuery,
} from "./collection-list";

const listPaths: Record<ContentCollectionKind, readonly string[]> = {
  series: ["/authoring/products", "/authoring/playlists"],
  topic: ["/authoring/topics"],
};

export interface CollectionListNavigation {
  /** Поиск и фильтр: заменяет текущую запись истории. */
  readonly replace: (next: CollectionListQuery) => void;
  /** Открыть или закрыть тему: новая запись, «назад» возвращает прежний вид. */
  readonly push: (next: CollectionListQuery) => void;
}

/**
 * Адрес владеет состоянием списка. Своя запись в адрес не перечитывается: набранный текст поиска
 * остаётся как есть, пробел в конце не пропадает. Скрытая страница (ADR 0027), пока открыт другой
 * адрес, адрес не пишет и чужих параметров не читает.
 */
export function useCollectionListQuery(
  kind: ContentCollectionKind,
): readonly [CollectionListQuery, CollectionListNavigation] {
  const pathname = usePathname();
  const urlSearch = useSearchParams().toString();
  const onList = listPaths[kind].includes(pathname);
  const [state, setState] = useState(() => ({
    urlSearch,
    query: parseCollectionListQuery(new URLSearchParams(urlSearch), kind),
  }));
  let current = state;
  if (onList && state.urlSearch !== urlSearch) {
    current = {
      urlSearch,
      query:
        serializeCollectionListQuery(state.query) === urlSearch
          ? state.query
          : parseCollectionListQuery(new URLSearchParams(urlSearch), kind),
    };
    setState(current);
  }

  const write = (mode: "push" | "replace", next: CollectionListQuery) => {
    setState((previous) => ({ urlSearch: previous.urlSearch, query: next }));
    const path = window.location.pathname;
    if (!listPaths[kind].includes(path)) return;
    const search = serializeCollectionListQuery(next);
    const href = search === "" ? path : `${path}?${search}`;
    if (`${path}${window.location.search}` === href) return;
    if (mode === "push") window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
  };

  return [
    current.query,
    {
      replace: (next) => {
        write("replace", next);
      },
      push: (next) => {
        write("push", next);
      },
    },
  ];
}
