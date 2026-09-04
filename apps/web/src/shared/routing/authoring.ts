import type { Route } from "next";

import { internalRoute } from "./internal-route";

export const authoringMaterialsRootHref = internalRoute("/authoring/materials");

export function parseAuthoringReturnHref(value: unknown): Route {
  if (typeof value !== "string" || value.length > 512) {
    return authoringMaterialsRootHref;
  }
  let url: URL;
  try {
    url = new URL(value, "https://inside.local");
  } catch {
    return authoringMaterialsRootHref;
  }
  if (
    url.origin !== "https://inside.local" ||
    url.pathname !== authoringMaterialsRootHref
  ) {
    return authoringMaterialsRootHref;
  }
  const allowedKeys = new Set(["page", "search", "state"]);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
    return authoringMaterialsRootHref;
  }
  return internalRoute(`${url.pathname}${url.search}`);
}

export function withAuthoringReturnHref(pathname: string, returnHref: Route): Route {
  return internalRoute(
    `${pathname}?${new URLSearchParams({ from: returnHref }).toString()}`,
  );
}
