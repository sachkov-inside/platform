"use client";

import { useEffect, useRef } from "react";

/** Run after the actual reader body arrives, including a streamed destination. */
export function MaterialFragmentNavigation() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const body = marker.current?.parentElement;
    if (body === undefined || body === null) return;
    const navigate = () => {
      if (window.location.hash === "") return;
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        id = window.location.hash.slice(1);
      }
      const target = Array.from(
        body.querySelectorAll<HTMLElement>("[id]"),
      ).find((element) => element.id === id);
      if (target !== undefined) {
        for (
          let parent = target.parentElement;
          parent !== null && body.contains(parent);
          parent = parent.parentElement
        ) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        target.scrollIntoView({ block: "start", behavior: "instant" });
      } else {
        const container = body.closest("#content");
        if (container !== null)
          container.scrollTo({ top: 0, behavior: "instant" });
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    };
    navigate();
    window.addEventListener("hashchange", navigate);
    return () => {
      window.removeEventListener("hashchange", navigate);
    };
  }, []);
  return <span hidden ref={marker} />;
}
