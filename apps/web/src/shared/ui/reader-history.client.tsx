"use client";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Route } from "next";
import {
  readerHistoryEntryEvent,
  resetReaderHistoryActivation,
  enterReaderHistory,
  prepareReaderHistory,
  readerOriginHref,
  prepareReaderOriginReturn,
  saveReaderHistoryView,
} from "../lib/reader-history";
import { internalRoute } from "../routing/internal-route";
import { IntentPrefetchLink } from "./intent-prefetch-link.client";

function Tracker({
  originHref,
  path,
}: {
  readonly originHref?: string | undefined;
  readonly path: string;
}) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    const matchesDocument = () =>
      window.location.pathname === path &&
      new URLSearchParams(window.location.search).toString() === query;
    if (!matchesDocument()) return;
    const save = () => {
      if (matchesDocument()) saveReaderHistoryView();
    };
    enterReaderHistory(originHref);
    const click = (event: MouseEvent) => {
      if (matchesDocument()) prepareReaderHistory(event, originHref);
    };
    const pop = () => {
      resetReaderHistoryActivation();
      if (matchesDocument()) enterReaderHistory(originHref);
    };
    let frame: number | undefined;
    const scroll = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        save();
      });
    };
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("click", click, true);
    window.addEventListener("pagehide", save);
    window.addEventListener("popstate", pop);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("popstate", pop);
    };
  }, [pathname, query, originHref, path]);
  return null;
}

export function ReaderHistoryTracker(props: {
  readonly path: string;
  readonly originHref?: string | undefined;
}) {
  return (
    <Suspense fallback={null}>
      <Tracker {...props} />
    </Suspense>
  );
}

export function ReaderOriginLink({
  href,
  children,
  className,
  ...linkProps
}: {
  readonly href: Route;
  readonly children: ReactNode;
  readonly className?: string;
  readonly "aria-label"?: string | undefined;
  readonly title?: string | undefined;
}) {
  const [target, setTarget] = useState(href);
  useEffect(() => {
    const update = () => {
      const origin = readerOriginHref(href);
      const url = origin === undefined ? undefined : new URL(origin);
      setTarget(
        url === undefined
          ? href
          : internalRoute(`${url.pathname}${url.search}${url.hash}`),
      );
    };
    update();
    window.addEventListener(readerHistoryEntryEvent, update);
    return () => {
      window.removeEventListener(readerHistoryEntryEvent, update);
    };
  }, [href]);
  return (
    <IntentPrefetchLink
      {...linkProps}
      href={target}
      className={className}
      onClick={(event) => {
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        )
          prepareReaderOriginReturn(target);
      }}
    >
      {children}
    </IntentPrefetchLink>
  );
}
