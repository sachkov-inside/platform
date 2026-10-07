import type { Route as Address } from "next/types";

/** `Route` из `next/types` — тот же тип под другим путём. */
export const productHref = (slug: string) => `/products/${slug}` as Address;
