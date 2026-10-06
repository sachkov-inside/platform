import type { Route } from "next";

/** Утверждение о вычисленном адресе принимает только одно из двух состояний `Route`. */
export function topicHref(slug: string): Route {
  return `/topics/${slug}` as Route;
}
