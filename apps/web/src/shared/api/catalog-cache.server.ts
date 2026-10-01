import "server-only";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";

/** Один тег на весь публичный каталог: авторская запись сбрасывает его целиком (ADR 0027). */
const CATALOG_CACHE_TAG = "catalog";

/**
 * Исход гостевого чтения каталога, как его называют адаптеры страниц. Перечень закрытый: исход под
 * новым именем не должен молча получить срок жизни найденного.
 */
type CatalogReadKind =
  "available" | "empty" | "not-found" | "ready" | "teaser" | "unavailable";

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
 * Команды биллинга, после которых описание продукта может назвать другие сроки: оно подставляет
 * из общего кеша сроки самого дешёвого предложения, а какое из них дешевле, решают и вариант
 * оплаты, и скидка. Остальные команды биллинга каталог не трогают.
 */
const offerTermWrites = [
  "/api/authoring/billing/offers/",
  "/api/authoring/billing/payment-options/",
  "/api/authoring/billing/promotions/",
] as const;

/**
 * Авторская запись меняет то, что видит гость: публикацию, состав продукта, обложку, закреп.
 * Из команд биллинга сюда входят только записи предложений, вариантов оплаты и скидок: в общем
 * кеше лежат сроки предложения продукта, а цены, скидки и потоки в него не попадают.
 */
export function isCatalogWrite(request: Request): boolean {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" || !pathname.startsWith("/api/authoring/"))
    return false;
  return (
    !pathname.startsWith("/api/authoring/billing/") ||
    offerTermWrites.some((prefix) => pathname.startsWith(prefix))
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
