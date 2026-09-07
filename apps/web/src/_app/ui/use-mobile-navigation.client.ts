"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

  const saveCurrent = useCallback(() => {
    const path = rootPaths.find((root) => root === window.location.pathname);
    if (path === undefined) return;
    const href = `${path}${window.location.search}` as Route;
    const position = { href, top: readScrollTop() };
    const previous = positions.current[path];
    positions.current = { ...positions.current, [path]: position };
    if (previous?.href !== href) setLinks(positions.current);
  }, []);

  useEffect(() => {
    const capture = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("a[href]") === null) return;
      stopRestoring.current();
      pending.current = null;
      saveCurrent();
    };
    document.addEventListener("click", capture, true);
    return () => { document.removeEventListener("click", capture, true); };
  }, [saveCurrent]);

  useLayoutEffect(() => {
    if (!authResolved) return;
    if (previousAccount.current !== undefined && previousAccount.current !== accountId) {
      stopRestoring.current();
      pending.current = null;
      positions.current = {};
      setLinks({});
      // Account presentation is shared by Profile and onboarding; never reuse the old identity.
      void queryClient.resetQueries({ queryKey: ["account", "presentation"] });
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
    restore();
    return stop;
  }, [pathname]);

  const onNavigate = useCallback((href: Route) => {
    stopRestoring.current();
    saveCurrent();
    const root = rootPaths.find((path) => path === href.split("?")[0]);
    pending.current = root === undefined ? null : positions.current[root] ?? { href, top: 0 };
  }, [saveCurrent]);

  return { libraryHref: links["/library"]?.href ?? "/library", onNavigate };
}

function readScrollTop(): number {
  return window.matchMedia("(min-width: 64rem)").matches
    ? document.getElementById("content")?.scrollTop ?? 0
    : window.scrollY;
}
