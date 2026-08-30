import type { Route } from "next";

export const authoringMaterialsRootHref = ("/authoring" + "/materials") as Route;

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
  return `${url.pathname}${url.search}` as Route;
}

export function withAuthoringReturnHref(pathname: string, returnHref: Route): Route {
  return `${pathname}?${new URLSearchParams({ from: returnHref }).toString()}` as Route;
}
