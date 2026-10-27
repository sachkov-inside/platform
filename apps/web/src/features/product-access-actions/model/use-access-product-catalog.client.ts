"use client";

import { useQuery } from "@tanstack/react-query";

import { requestAccessProductCatalog } from "../api/product-catalog.browser";
import {
  accessProductCatalogQueryKey,
  type AccessProductCatalog,
} from "./product-catalog";

export type AccessProductCatalogView =
  { readonly kind: "loading" } | AccessProductCatalog;

/** Каталог продуктов для выдачи и фильтров; одно чтение на вкладку. */
export function useAccessProductCatalog(): AccessProductCatalogView {
  const catalog = useQuery({
    queryKey: accessProductCatalogQueryKey,
    queryFn: ({ signal }) => requestAccessProductCatalog(signal),
  });
  return catalog.data ?? { kind: "loading" };
}
