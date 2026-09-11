import "server-only";

import { connection } from "next/server";

import { readWebRuntimeConfig } from "@/shared/config/index.server";

/**
 * Публичный адрес площадки на момент запроса.
 *
 * `connection()` держит чтение вне сборки: домен приходит из среды выполнения, поэтому карточки
 * ссылок и карта сайта переживают перенос домена без пересборки образа.
 */
export async function readPublicSiteOrigin(): Promise<URL> {
  await connection();
  return new URL(readWebRuntimeConfig().identity.baseUrl);
}

/** Абсолютный адрес публичной страницы для карты сайта и `robots.txt`. */
export function publicPageUrl(origin: URL, path: string): string {
  return new URL(path, origin).toString();
}
