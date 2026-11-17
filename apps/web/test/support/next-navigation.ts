import { createElement, type ReactNode } from "react";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

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

/** Supplies actual Next navigation contexts to an SSR fixture, rejecting navigation side effects. */
export function withNextNavigation(children: ReactNode, search = "") {
  return createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(
      SearchParamsContext.Provider,
      { value: new URLSearchParams(search) },
      children,
    ),
  );
}
