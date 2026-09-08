"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";

import { accountPresentationQueryKey } from "@/features/account-access";
import { libraryCatalogQueryOptions, parseLibrarySearchParams } from "@/features/library-catalog";

const rootPaths = ["/", "/library", "/account"] as const;
type RootPath = typeof rootPaths[number];
interface TabPosition { readonly href: Route; readonly top: number }
type TabPositions = Partial<Record<RootPath, TabPosition>>;
const prefetchDelayMs = 250;
const restorationTimeoutMs = 3_000;

/** Remembers only the three root tabs; App Router still owns routing and browser history. */
export function useMobileNavigation(pathname: string, accountId: string | null, authResolved: boolean) {
  const positions = useRef<TabPositions>({});
  const [links, setLinks] = useState<TabPositions>({});
  const pending = useRef<TabPosition | null>(null);
  const stopRestoring = useRef<() => void>(() => undefined);
  const previousAccount = useRef<string | null | undefined>(undefined);
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const [selectedHref, setSelectedHref] = useState<Route | null>(null);
  const pendingHref = isNavigating && selectedHref?.split("?")[0] !== pathname ? selectedHref : null;

  const recordLocation = useCallback((pathname: string, search: string) => {
    const path = rootPaths.find((root) => root === pathname);
    if (path === undefined) return;
    const href = `${path}${search.length > 0 ? `?${search}` : ""}` as Route;
    const previous = positions.current[path];
    const top = pending.current?.href.split("?")[0] === path
      ? pending.current.top
      : path === window.location.pathname ? readScrollTop() : previous?.top ?? 0;
    const position = { href, top };
    positions.current = { ...positions.current, [path]: position };
    if (previous?.href !== href) setLinks(positions.current);
  }, []);

  const saveCurrent = useCallback(() => {
    recordLocation(window.location.pathname, window.location.search.slice(1));
  }, [recordLocation]);

  useEffect(() => {
    const capture = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("a[href]") === null) return;
      stopRestoring.current();
      pending.current = null;
      saveCurrent();
    };
    const cancelSelection = () => { setSelectedHref(null); };
    window.addEventListener("popstate", cancelSelection);
    document.addEventListener("click", capture, true);
    // Record before native Back/Forward changes the URL; popstate is already too late.
    document.addEventListener("scroll", saveCurrent, { capture: true, passive: true });
    return () => {
      window.removeEventListener("popstate", cancelSelection);
      document.removeEventListener("click", capture, true);
      document.removeEventListener("scroll", saveCurrent, true);
    };
  }, [saveCurrent]);

  useLayoutEffect(() => {
    if (!authResolved) return;
    if (previousAccount.current !== undefined && previousAccount.current !== accountId) {
      stopRestoring.current();
      pending.current = null;
      positions.current = {};
      setLinks({});
      // Account presentation is shared by Profile and onboarding; never reuse the old identity.
      void queryClient.resetQueries({ queryKey: accountPresentationQueryKey() });
    }
    previousAccount.current = accountId;
  }, [accountId, authResolved, queryClient]);

  useEffect(() => {
    if (!authResolved || pathname === "/library") return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const href = positions.current["/library"]?.href ?? "/library";
      const query = parseLibrarySearchParams(new URL(href, window.location.origin).searchParams).query;
      void queryClient.infiniteQuery(libraryCatalogQueryOptions(query)).catch(() => undefined);
    }, prefetchDelayMs);
    return () => { window.clearTimeout(timer); };
  }, [authResolved, pathname, queryClient]);

  useLayoutEffect(() => {
    const destination = pending.current;
    if (destination === null || destination.href.split("?")[0] !== pathname) return;
    pending.current = null;
    const main = document.getElementById("content");
    if (main === null) return;
    let frame = 0;
    const stop = () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("popstate", stop);
    };
    const restore = () => {
      const scrollRoot = window.matchMedia("(min-width: 64rem)").matches ? main : document.documentElement;
      const available = scrollRoot.scrollHeight - scrollRoot.clientHeight;
      if (available + 1 < destination.top) return;
      if (scrollRoot === main) main.scrollTo({ top: destination.top, behavior: "instant" });
      else window.scrollTo({ top: destination.top, behavior: "instant" });
      stop();
    };
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(restore);
    });
    const timer = window.setTimeout(stop, restorationTimeoutMs);
    observer.observe(main);
    if (main.firstElementChild !== null) observer.observe(main.firstElementChild);
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("keydown", stop);
    window.addEventListener("popstate", stop);
    stopRestoring.current = stop;
    // Restore after the route commit so browser scroll anchoring cannot offset this write.
    frame = window.requestAnimationFrame(restore);
    return stop;
  }, [pathname]);

  const onNavigate = useCallback((href: Route) => {
    stopRestoring.current();
    saveCurrent();
    const root = rootPaths.find((path) => path === href.split("?")[0]);
    pending.current = root === undefined ? null : positions.current[root] ?? { href, top: 0 };
    setSelectedHref(href);
    startNavigation(() => { router.push(href, { scroll: false }); });
  }, [router, saveCurrent]);

  return { libraryHref: links["/library"]?.href ?? "/library", onNavigate, recordLocation, pendingHref };
}

function readScrollTop(): number {
  return window.matchMedia("(min-width: 64rem)").matches
    ? document.getElementById("content")?.scrollTop ?? 0
    : window.scrollY;
}
