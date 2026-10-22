"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { accountPresentationQueryKey } from "@/features/account-access";
import { readShellScroll, restoreShellScroll } from "@/shared/lib/shell-scroll";
import { internalRoute } from "@/shared/routing/internal-route";
import {
  libraryCatalogQueryRootKey,
  homeFeedQueryOptions,
  parseLibrarySearchParams,
} from "@/features/library-catalog";

const rootPaths = ["/", "/bookmarks", "/account"] as const;
type RootPath = (typeof rootPaths)[number];
interface TabPosition {
  readonly href: Route;
  readonly top: number;
}
type TabPositions = Partial<Record<RootPath, TabPosition>>;
const prefetchDelayMs = 250;
const restorationTimeoutMs = 3_000;

/** Remembers the root tabs; App Router still owns routing and browser history. */
export function useMobileNavigation(
  pathname: string,
  accountId: string | null,
  authResolved: boolean,
) {
  const positions = useRef<TabPositions>({});
  const [links, setLinks] = useState<TabPositions>({});
  const pending = useRef<TabPosition | null>(null);
  const stopRestoring = useRef<() => void>(() => undefined);
  const previousAccount = useRef<string | null | undefined>(undefined);
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const [selectedHref, setSelectedHref] = useState<Route | null>(null);
  const pendingHref =
    isNavigating && selectedHref?.split("?")[0] !== pathname
      ? selectedHref
      : null;

  const recordLocation = useCallback((pathname: string, search: string) => {
    const path = rootPaths.find((root) => root === pathname);
    if (path === undefined) return;
    const href = internalRoute(
      `${path}${search.length > 0 ? `?${search}` : ""}`,
    );
    const previous = positions.current[path];
    const top =
      pending.current?.href.split("?")[0] === path
        ? pending.current.top
        : path === window.location.pathname
          ? readShellScroll()
          : (previous?.top ?? 0);
    const position = { href, top };
    positions.current = { ...positions.current, [path]: position };
    if (previous?.href !== href) setLinks(positions.current);
  }, []);

  const saveCurrent = useCallback(() => {
    recordLocation(window.location.pathname, window.location.search.slice(1));
  }, [recordLocation]);

  useEffect(() => {
    const capture = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        anchor === null ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      stopRestoring.current();
      pending.current = null;
      saveCurrent();
      const destination = new URL(anchor.href, window.location.origin);
      if (
        destination.origin !== window.location.origin ||
        destination.hash !== ""
      )
        return;
      const root = rootPaths.find((path) => path === destination.pathname);
      const saved = root === undefined ? undefined : positions.current[root];
      if (saved?.href === `${destination.pathname}${destination.search}`)
        pending.current = saved;
    };
    const cancelSelection = () => {
      setSelectedHref(null);
    };
    window.addEventListener("popstate", cancelSelection);
    document.addEventListener("click", capture, true);
    // Record before native Back/Forward changes the URL; popstate is already too late.
    document.addEventListener("scroll", saveCurrent, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("popstate", cancelSelection);
      document.removeEventListener("click", capture, true);
      document.removeEventListener("scroll", saveCurrent, true);
    };
  }, [saveCurrent]);

  useLayoutEffect(() => {
    if (!authResolved) return;
    if (
      previousAccount.current !== undefined &&
      previousAccount.current !== accountId
    ) {
      stopRestoring.current();
      pending.current = null;
      positions.current = {};
      setLinks({});
      // Account presentation is shared by Profile and onboarding; never reuse the old identity.
      void queryClient.resetQueries({
        queryKey: accountPresentationQueryKey(),
      });
      void queryClient.resetQueries({ queryKey: libraryCatalogQueryRootKey() });
    }
    previousAccount.current = accountId;
  }, [accountId, authResolved, queryClient]);

  useEffect(() => {
    if (!authResolved || pathname === "/") return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const href = positions.current["/"]?.href ?? "/";
      const query = parseLibrarySearchParams(
        new URL(href, window.location.origin).searchParams,
      ).query;
      void queryClient
        .infiniteQuery(homeFeedQueryOptions(query))
        .catch(() => undefined);
    }, prefetchDelayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [authResolved, pathname, queryClient]);

  useLayoutEffect(() => {
    const destination = pending.current;
    if (destination === null || destination.href.split("?")[0] !== pathname)
      return;
    pending.current = null;
    // Waits for the destination to grow tall enough; reader input or a timeout cancels it.
    const stop = restoreShellScroll(destination.top, restorationTimeoutMs);
    stopRestoring.current = stop;
    return stop;
  }, [pathname]);

  const onNavigate = useCallback(
    (href: Route) => {
      stopRestoring.current();
      saveCurrent();
      const root = rootPaths.find((path) => path === href.split("?")[0]);
      pending.current =
        root === undefined
          ? null
          : (positions.current[root] ?? { href, top: 0 });
      setSelectedHref(href);
      startNavigation(() => {
        router.push(href, { scroll: false });
      });
    },
    [router, saveCurrent],
  );

  return {
    homeHref: links["/"]?.href ?? "/",
    onNavigate,
    recordLocation,
    pendingHref,
  };
}
