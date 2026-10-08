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
  if (returnProductId(url.pathname) !== undefined) {
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

/** Подпись ссылки по адресу возврата, который уже прошёл `parseAuthoringReturnHref`. */
export function authoringReturnLabel(returnHref: Route): string {
  return returnProductId(returnHref) === undefined
    ? "К материалам"
    : "К продукту";
}

/** Подпись кнопки возврата по адресу, который уже прошёл `parseAuthoringReturnHref`. */
export function authoringReturnActionLabel(returnHref: string): string {
  return returnProductId(returnHref) === undefined
    ? "Вернуться к материалам"
    : "Вернуться к продукту";
}

/** Продукт, в редактор которого ведёт адрес возврата; у списка материалов продукта нет. */
function returnProductId(pathname: string): string | undefined {
  if (!pathname.startsWith(authoringProductsPrefix)) return undefined;
  const parsed = productIdSchema.safeParse(
    pathname.slice(authoringProductsPrefix.length),
  );
  return parsed.success ? parsed.data : undefined;
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
 * черновики. Без него руководство берётся из адреса возврата в редактор продукта, а без такого
 * адреса предпросмотр берёт первое руководство материала.
 */
export function authoringMaterialPreviewHref(
  materialId: string,
  returnHref: Route,
  productId: string | undefined = returnProductId(returnHref),
): Route {
  return internalRoute(
    `/authoring/materials/${materialId}/preview?${new URLSearchParams({
      from: returnHref,
      ...(productId === undefined ? {} : { product: productId }),
    }).toString()}`,
  );
}
