"use client";
import { useEffect } from "react";

export function useLessonFragmentNavigation(
  partCount: number,
  open: (count: number, sync: boolean) => boolean,
  scrollAfterReveal: (id: string) => void,
) {
  useEffect(() => {
    if (partCount === 1) return;
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
    if (reveal(window.location.hash, false))
      scrollAfterReveal(safeDecode(window.location.hash.slice(1)));
    document.addEventListener("click", followLink, true);
    window.addEventListener("hashchange", followHash);
    return () => {
      document.removeEventListener("click", followLink, true);
      window.removeEventListener("hashchange", followHash);
    };
  }, [open, partCount, scrollAfterReveal]);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
