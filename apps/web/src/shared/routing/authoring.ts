import type { Route } from "next";
import { z } from "zod";

import { internalRoute } from "./internal-route";

export const authoringMaterialsRootHref = internalRoute("/authoring/materials");

const authoringProductsPrefix = "/authoring/products/";
const productIdSchema = z.uuid();

export function authoringProductEditorHref(productId: string): Route {
  return internalRoute(`${authoringProductsPrefix}${productId}`);
}

/**
 * Возврат из редактора и предпросмотра материала: список материалов со своим поиском или
 * редактор продукта, из которого автор открыл материал (#837). Всё остальное — корень списка.
 */
export function parseAuthoringReturnHref(value: unknown): Route {
  if (typeof value !== "string" || value.length > 512) {
    return authoringMaterialsRootHref;
  }
  let url: URL;
  try {
    url = new URL(value, "https://inside.local");
  } catch {
    return authoringMaterialsRootHref;
  }
  if (url.origin !== "https://inside.local") {
    return authoringMaterialsRootHref;
  }
  if (isProductEditorPath(url.pathname)) {
    return url.search === ""
      ? internalRoute(url.pathname)
      : authoringMaterialsRootHref;
  }
  if (url.pathname !== authoringMaterialsRootHref) {
    return authoringMaterialsRootHref;
  }
  const allowedKeys = new Set(["page", "search", "state"]);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
    return authoringMaterialsRootHref;
  }
  return internalRoute(`${url.pathname}${url.search}`);
}

/** Подпись перехода по адресу возврата, который уже прошёл `parseAuthoringReturnHref`. */
export function authoringReturnLabel(returnHref: Route): string {
  return isProductEditorPath(returnHref) ? "К продукту" : "К материалам";
}

function isProductEditorPath(pathname: string): boolean {
  return (
    pathname.startsWith(authoringProductsPrefix) &&
    productIdSchema.safeParse(pathname.slice(authoringProductsPrefix.length))
      .success
  );
}

export function withAuthoringReturnHref(
  pathname: string,
  returnHref: Route,
): Route {
  return internalRoute(
    `${pathname}?${new URLSearchParams({ from: returnHref }).toString()}`,
  );
}

/**
 * Предпросмотр материала. `productId` выбирает руководство, по маршруту которого автор листает
 * черновики; без него предпросмотр берёт первое руководство материала.
 */
export function authoringMaterialPreviewHref(
  materialId: string,
  returnHref: Route,
  productId?: string,
): Route {
  return internalRoute(
    `/authoring/materials/${materialId}/preview?${new URLSearchParams({
      from: returnHref,
      ...(productId === undefined ? {} : { product: productId }),
    }).toString()}`,
  );
}
