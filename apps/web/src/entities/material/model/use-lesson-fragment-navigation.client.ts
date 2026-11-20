"use client";
import { useEffect, type RefObject } from "react";

export function useLessonFragmentNavigation(
  partCount: number,
  open: (count: number, sync: boolean) => boolean,
  pendingScroll: RefObject<string | null>,
) {
  useEffect(() => {
    if (partCount === 1) return;
    // Cuts stand in document order: the target's part is the last cut before it.
    const partOfTarget = (hash: string): number | undefined => {
      if (hash === "" || hash === "#") return undefined;
      const target = document.getElementById(safeDecode(hash.slice(1)));
      if (target === null) return undefined;
      let part = 0;
      for (const cut of document.querySelectorAll<HTMLElement>(
        "[data-lesson-part]",
      ))
        if (
          (cut.compareDocumentPosition(target) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0
        )
          part = Math.max(part, Number(cut.dataset["lessonPart"]));
      return part;
    };
    const reveal = (hash: string, sync: boolean): boolean => {
      const part = partOfTarget(hash);
      return part !== undefined && open(part + 1, sync);
    };
    const followLink = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (link === null) return;
      const target = new URL(link.href);
      const current = new URL(window.location.href);
      if (
        target.hash === "" ||
        target.origin !== current.origin ||
        target.pathname !== current.pathname
      )
        return;
      reveal(target.hash, true);
    };
    const followHash = () => {
      if (!reveal(window.location.hash, true)) return;
      document
        .getElementById(safeDecode(window.location.hash.slice(1)))
        ?.scrollIntoView({ block: "start", behavior: "instant" });
    };
    // The page opened at an anchor: its part renders first, then the body scrolls to it.
    if (reveal(window.location.hash, false))
      pendingScroll.current = safeDecode(window.location.hash.slice(1));
    document.addEventListener("click", followLink, true);
    window.addEventListener("hashchange", followHash);
    return () => {
      document.removeEventListener("click", followLink, true);
      window.removeEventListener("hashchange", followHash);
    };
  }, [open, partCount, pendingScroll]);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
