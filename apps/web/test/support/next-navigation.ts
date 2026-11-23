import { createElement, type ReactNode } from "react";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";

function unexpectedNavigation(): never {
  throw new Error("A server-rendered fixture cannot navigate");
}

const router: AppRouterInstance = {
  back: unexpectedNavigation,
  forward: unexpectedNavigation,
  refresh: unexpectedNavigation,
  push: unexpectedNavigation,
  replace: unexpectedNavigation,
  prefetch: unexpectedNavigation,
  bfcacheId: "module-ssr",
};

/**
 * Supplies actual Next navigation contexts to an SSR fixture, rejecting navigation side effects.
 * `pathname` places the fixture on its route, so address parameters such as `at` apply to it.
 */
export function withNextNavigation(
  children: ReactNode,
  search = "",
  pathname: string | null = null,
) {
  const routed = createElement(
    SearchParamsContext.Provider,
    { value: new URLSearchParams(search) },
    children,
  );
  return createElement(
    AppRouterContext.Provider,
    { value: router },
    pathname === null
      ? routed
      : createElement(PathnameContext.Provider, { value: pathname }, routed),
  );
}
