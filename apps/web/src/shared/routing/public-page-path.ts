import type { Route } from "next";

import { internalRoute } from "./internal-route";

/**
 * Канонические адреса публичных страниц. Руководство живёт по `/guides/<slug>`; `/series/<slug>`
 * остался совместимым адресом той же страницы и ведёт на канонический адрес, а не спорит с ним.
 */
export const HOME_PATH = internalRoute("/");
export const LIBRARY_PATH = internalRoute("/library");

export function materialPath(slug: string): Route {
  return internalRoute(`/materials/${encodeURIComponent(slug)}`);
}

export function guidePath(slug: string): Route {
  return internalRoute(`/guides/${encodeURIComponent(slug)}`);
}

export function topicPath(slug: string): Route {
  return internalRoute(`/topics/${encodeURIComponent(slug)}`);
}

/**
 * Адрес сгенерированной карточки страницы: та же ветка адресов плюс `social-card`.
 * У главной собственной ветки нет, поэтому её карточка лежит в корне.
 */
export function socialCardPath(pagePath: string): Route {
  return internalRoute(
    pagePath === HOME_PATH ? "/social-card" : `${pagePath}/social-card`,
  );
}
