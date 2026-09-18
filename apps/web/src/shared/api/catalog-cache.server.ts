import "server-only";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";

/** Один тег на весь публичный каталог: авторская запись сбрасывает его целиком (ADR 0026). */
const CATALOG_CACHE_TAG = "catalog";

/**
 * Исход гостевого чтения каталога, как его называют адаптеры страниц. Перечень закрытый: исход под
 * новым именем не должен молча получить срок жизни найденного.
 */
type CatalogReadKind = "available" | "empty" | "not-found" | "ready" | "teaser" | "unavailable";

/**
 * Вызывается внутри функции с `"use cache"` после того, как исход чтения известен: срок жизни записи
 * зависит от него. Найденное живёт по профилю `catalog`; отсутствующий адрес может появиться после
 * публикации; сбой зависимости не должен застыть ни в кеше, ни в предсобранной оболочке, поэтому его
 * запись истекает раньше, чем успевает кому-то пригодиться. Профили описаны в `next.config.ts`.
 */
export function applyCatalogCachePolicy(kind: CatalogReadKind): void {
  cacheTag(CATALOG_CACHE_TAG);
  // У `cacheLife` перегрузка на каждое имя профиля, поэтому имя передаётся литералом.
  if (kind === "unavailable") cacheLife("catalogUnavailable");
  else if (kind === "not-found") cacheLife("catalogMissing");
  else cacheLife("catalog");
}

/**
 * Авторская запись меняет то, что видит гость: публикацию, состав продукта, обложку, закреп.
 * Команды биллинга сюда не входят — цены и предложения в общий кеш не попадают.
 */
export function isCatalogWrite(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return (
    request.method !== "GET" &&
    pathname.startsWith("/api/authoring/") &&
    !pathname.startsWith("/api/authoring/billing/")
  );
}

/**
 * Общий кеш каталога сбрасывается сразу после авторской записи, чтобы изменение было видно со
 * следующего запроса, а не через окно обновления. Исход записи не разбирается: лишний сброс стоит
 * одного повторного чтения backend, а пропущенный показывал бы старую страницу.
 */
export function expirePublicCatalogAfter(request: Request): void {
  if (isCatalogWrite(request)) expirePublicCatalog();
}

/** Сброс без разбора запроса — для пути, который уже знает, что это запись каталога. */
export function expirePublicCatalog(): void {
  revalidateTag(CATALOG_CACHE_TAG, { expire: 0 });
}
