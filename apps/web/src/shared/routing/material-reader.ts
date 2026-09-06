import type { Route } from "next";

import { internalRoute } from "./internal-route";
import { readCanonicalLibraryRouteHref } from "./library-route";

export type MaterialReaderReturnKind =
  | "home"
  | "library"
  | "profile"
  | "series"
  | "topic";

export interface MaterialReaderReturnTarget {
  readonly href: Route;
  readonly kind: MaterialReaderReturnKind;
  readonly label:
    | "Назад в Базу знаний"
    | "Назад в профиль"
    | "Назад на Главную"
    | "Назад к серии"
    | "Назад к теме";
  readonly seriesSlug?: string;
}

const applicationOrigin = "https://inside.local";
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const libraryMaterialReaderReturnTarget: MaterialReaderReturnTarget =
  Object.freeze({
    href: internalRoute("/library"),
    kind: "library",
    label: "Назад в Базу знаний",
  });

export function materialReaderOriginHref(
  kind: "series" | "topic",
  slug: string,
): Route {
  assertSlug(slug);
  return internalRoute(`/${kind === "series" ? "series" : "topics"}/${slug}`);
}

export function materialReaderHref(slug: string, returnHref?: Route): Route {
  assertSlug(slug);
  const pathname = `/materials/${slug}`;
  if (returnHref === undefined) return internalRoute(pathname);
  if (readReturnTarget(returnHref) === undefined) {
    throw new TypeError("Expected a supported Material Reader return route");
  }
  return internalRoute(
    `${pathname}?${new URLSearchParams({ from: returnHref }).toString()}`,
  );
}

export function collectionDiscoveryHref(
  kind: "series" | "topic",
  slug: string,
  returnHref?: Route,
): Route {
  assertSlug(slug);
  const pathname = `/${kind === "series" ? "series" : "topics"}/${slug}`;
  if (returnHref === undefined) return internalRoute(pathname);
  if (readReturnTarget(returnHref) === undefined) {
    throw new TypeError("Expected a supported discovery return route");
  }
  return internalRoute(
    `${pathname}?${new URLSearchParams({ from: returnHref }).toString()}`,
  );
}

export function parseMaterialReaderReturnTarget(
  value: unknown,
): MaterialReaderReturnTarget {
  return readReturnTarget(value) ?? libraryMaterialReaderReturnTarget;
}

function readReturnTarget(
  value: unknown,
  depth = 0,
): MaterialReaderReturnTarget | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512
  ) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value, applicationOrigin);
  } catch {
    return undefined;
  }
  if (url.origin !== applicationOrigin || url.hash.length > 0) return undefined;

  if (url.pathname === "/library") {
    const href = readCanonicalLibraryRouteHref(url);
    return href === undefined
      ? undefined
      : { ...libraryMaterialReaderReturnTarget, href };
  }
  if (url.pathname === "/" && url.search.length === 0) {
    return {
      href: internalRoute("/"),
      kind: "home",
      label: "Назад на Главную",
    };
  }
  if (url.pathname === "/account" && url.search.length === 0) {
    return {
      href: internalRoute("/account"),
      kind: "profile",
      label: "Назад в профиль",
    };
  }

  const match = /^\/(series|topics)\/([^/]+)$/u.exec(url.pathname);
  if (match === null || match[2] === undefined || !slugPattern.test(match[2])) {
    return undefined;
  }

  const routeKind = match[1];
  if (url.search.length > 0) {
    const from = singleSearchValue(url.searchParams, "from");
    if (
      depth >= 3 ||
      from === undefined ||
      [...url.searchParams.keys()].some((key) => key !== "from") ||
      readReturnTarget(from, depth + 1) === undefined
    ) {
      return undefined;
    }
  }

  const href = internalRoute(`${url.pathname}${url.search}`);
  if (routeKind === "series") {
    return {
      href,
      kind: "series",
      label: "Назад к серии",
      seriesSlug: match[2],
    };
  }
  if (routeKind === "topics") {
    return { href, kind: "topic", label: "Назад к теме" };
  }
  return undefined;
}

function singleSearchValue(
  search: URLSearchParams,
  name: string,
): string | undefined {
  const values = search.getAll(name);
  return values.length === 0
    ? undefined
    : values.length === 1
      ? values[0]
      : undefined;
}

function assertSlug(slug: string): void {
  if (!slugPattern.test(slug)) {
    throw new TypeError("Expected a canonical slug");
  }
}
