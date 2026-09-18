import "server-only";

import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

import type { HomeResult } from "../model/home-view";
import { getHome } from "./get-home";

/**
 * Главная глазами гостя. Страница берёт отсюда только закреплённый продукт, а он одинаков для всех;
 * лента материалов принадлежит браузеру и читается отдельно (ADR 0026).
 */
export async function readPublicHome(): Promise<HomeResult> {
  "use cache";
  const result = await getHome();
  applyCatalogCachePolicy(result.kind);
  return result;
}
