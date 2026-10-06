import type * as next from "next";
import type { Route as Href } from "next";

/** Другое имя типа не делает утверждение о вычисленном адресе верным в обоих состояниях. */
export const productHref = (slug: string) => `/products/${slug}` as Href;
export const seriesHref = (slug: string) => `/series/${slug}` as next.Route;
