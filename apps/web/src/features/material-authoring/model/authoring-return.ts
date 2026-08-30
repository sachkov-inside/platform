import type { Route } from "next";

const authoringMaterialsRoot = ("/authoring" + "/materials") as Route;

export function parseAuthoringReturnHref(value: unknown): Route {
  if (typeof value !== "string" || value.length > 512) {
    return authoringMaterialsRoot;
  }
  let url: URL;
  try {
    url = new URL(value, "https://inside.local");
  } catch {
    return authoringMaterialsRoot;
  }
  if (
    url.origin !== "https://inside.local" ||
    url.pathname !== authoringMaterialsRoot
  ) {
    return authoringMaterialsRoot;
  }
  const allowedKeys = new Set(["page", "search", "state"]);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
    return authoringMaterialsRoot;
  }
  return `${url.pathname}${url.search}` as Route;
}

export function withAuthoringReturnHref(pathname: string, returnHref: Route): Route {
  return `${pathname}?${new URLSearchParams({ from: returnHref }).toString()}` as Route;
}
