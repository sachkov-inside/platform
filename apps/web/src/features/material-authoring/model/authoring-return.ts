import type { Route } from "next";

export const authoringMaterialsRootHref = "/authoring/materials" satisfies Route;

function isInternalRoute(value: string): value is Route {
  return value.startsWith("/") && !value.startsWith("//");
}

function internalRoute(value: string): Route {
  if (!isInternalRoute(value)) {
    throw new TypeError("Expected an internal application route");
  }
  return value;
}

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
