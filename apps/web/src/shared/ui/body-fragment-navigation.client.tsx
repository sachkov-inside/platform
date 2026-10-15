"use client";

import { useEffect, useRef } from "react";

/** Run after the actual document body arrives, including a streamed destination. */
export function BodyFragmentNavigation() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const body = marker.current?.parentElement;
    if (body === undefined || body === null) return;
    const navigate = () => {
      if (body.getClientRects().length === 0) return;
      if (window.location.hash === "") return;
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        id = window.location.hash.slice(1);
      }
      const target =
        Array.from(body.querySelectorAll<HTMLElement>("[id]")).find(
          (element) => element.id === id,
        ) ?? body.ownerDocument.getElementById(id);
      if (target !== null) {
        for (
          let parent = target.parentElement;
          parent !== null && body.contains(parent);
          parent = parent.parentElement
        ) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        target.scrollIntoView({ block: "start", behavior: "instant" });
      } else {
        for (
          let parent: HTMLElement | null = body;
          parent !== null;
          parent = parent.parentElement
        )
          parent.scrollTo({ top: 0, behavior: "instant" });
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    };
    let frame: number | undefined;
    const repeatFragment = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        link === null ||
        link.hasAttribute("download") ||
        (link.target !== "" && link.target !== "_self")
      )
        return;
      const target = new URL(link.href);
      // A repeated fragment emits no hashchange; native lookup may select a retained hidden page.
      if (target.hash === "" || target.href !== window.location.href) return;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        navigate();
      });
    };
    navigate();
    body.addEventListener("click", repeatFragment);
    window.addEventListener("hashchange", navigate);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      body.removeEventListener("click", repeatFragment);
      window.removeEventListener("hashchange", navigate);
    };
  }, []);
  return <span hidden ref={marker} />;
}
