import type { Route } from "next";

export function internalRoute(value: string): Route {
  if (!isInternalRoute(value)) {
    throw new TypeError("Expected an internal application route");
  }
  return value;
}

function isInternalRoute(value: string): value is Route {
  return value.startsWith("/") && !value.startsWith("//");
}
