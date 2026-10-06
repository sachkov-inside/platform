import type { Route as Address } from "next/types";

/** `Route` из `next/types` — тот же тип под другим путём. */
export const guideHref = (slug: string) => `/guides/${slug}` as Address;
