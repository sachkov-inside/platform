"use client";

import { useEffect, useRef } from "react";

/** Run after the actual document body arrives, including a streamed destination. */
export function BodyFragmentNavigation() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const body = marker.current?.parentElement;
    if (body === undefined || body === null) return;
    // Only a followed same-page link animates; a load, a reload or history traversal jumps.
    let smooth = false;
    let smoothRoots: HTMLElement[] = [];
    let settle: number | undefined;
    const releaseSmooth = () => {
      smooth = false;
      if (settle !== undefined) window.clearTimeout(settle);
      settle = undefined;
      for (const root of smoothRoots)
        root.style.removeProperty("scroll-behavior");
      smoothRoots = [];
    };
    const navigate = () => {
      const behavior = smooth ? "smooth" : "instant";
      releaseSmooth();
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
        target.scrollIntoView({ block: "start", behavior });
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
    const followFragment = (event: MouseEvent) => {
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
      const current = new URL(window.location.href);
      if (target.hash === "" || target.origin !== current.origin) return;
      target.hash = "";
      current.hash = "";
      if (target.href !== current.href) return;
      // Without an animation the jump feels like opening another page.
      smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (link.href !== window.location.href) {
        if (!smooth) return;
        // The browser scrolls before `hashchange`; let that native scroll animate as well.
        smoothRoots = [];
        for (
          let parent: HTMLElement | null = body;
          parent !== null;
          parent = parent.parentElement
        ) {
          parent.style.setProperty("scroll-behavior", "smooth");
          smoothRoots.push(parent);
        }
        settle = window.setTimeout(releaseSmooth, 1000);
        return;
      }
      // A repeated fragment emits no hashchange; native lookup may select a retained hidden page.
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        navigate();
      });
    };
    navigate();
    body.addEventListener("click", followFragment);
    window.addEventListener("hashchange", navigate);
    return () => {
      releaseSmooth();
      if (frame !== undefined) cancelAnimationFrame(frame);
      body.removeEventListener("click", followFragment);
      window.removeEventListener("hashchange", navigate);
    };
  }, []);
  return <span hidden ref={marker} />;
}
