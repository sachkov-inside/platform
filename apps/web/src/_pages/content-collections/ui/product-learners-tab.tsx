import { usePeopleSearch } from "@/entities/authoring-person";
import { issueProductAccessOperation } from "@/entities/subscription";
import {
  ProductLearnersTab as ProductHoldersTab,
  type GrantPeopleSearchState,
} from "@/features/product-holders";

/** Сколько людей показывает поиск в «Выдать продукт». */
const GRANT_SEARCH_LIMIT = 20;

/**
 * Поиск людей #1721 в форме, которую ждёт выдача продукта. Отказ, конец сессии и сбой чтения для
 * выбора людей одинаковы: искать сейчас нельзя.
 */
function useGrantPeopleSearch(query: string): GrantPeopleSearchState {
  const search = usePeopleSearch(query, { limit: GRANT_SEARCH_LIMIT });
  switch (search.kind) {
    case "idle":
    case "loading":
      return search;
    case "ready":
      return {
        kind: "ready",
        items: search.items,
        nameSearch: search.nameSearch,
      };
    case "signed_out":
    case "forbidden":
    case "unavailable":
      return { kind: "unavailable" };
  }
}

/**
 * Вкладка «Ученики» страницы продукта: таблица обладателей и выдача продукта нескольким людям.
 * Страница соединяет её с поиском людей и единственной выдачей Product Access.
 */
export function ProductLearnersTab({
  productId,
  productName,
}: {
  readonly productId: string;
  readonly productName: string;
}) {
  return (
    <ProductHoldersTab
      issueProductAccess={issueProductAccessOperation.send}
      productId={productId}
      productName={productName}
      usePeopleSearch={useGrantPeopleSearch}
    />
  );
}
