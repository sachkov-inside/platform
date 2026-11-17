import {
  checkInlineSvgMarkup,
  SVG_CONTENT_TYPE,
} from "@inside/material-blocks/svg-image";

/** Full protected source URL is the identity: permissions, version and context stay in the request. */
export async function readSvgFigure(
  src: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (typeof IntersectionObserver !== "function") return null;
  try {
    const response = await fetch(src, { credentials: "same-origin", signal });
    if (!response.ok) return null;
    const checked = checkInlineSvgMarkup(await response.text());
    if (!checked.ok) return null;
    return parseSvg(checked.value.markup) === null
      ? null
      : checked.value.markup;
  } catch {
    return null;
  }
}

/** Mount only validated XML; the same host lifetime owns placement and the one-shot visibility gate. */
export function mountSvgFigure(
  element: HTMLElement,
  markup: string,
  playback: { markup: string | null; playing: boolean },
): () => void {
  const root = parseSvg(markup);
  if (root === null) throw new Error("Expected checked SVG markup");
  const svg = document.importNode(root, true);
  svg.setAttribute("aria-hidden", "true");
  element.replaceChildren(svg);
  if (playback.markup !== markup) {
    playback.markup = markup;
    playback.playing = false;
  }
  const play = playback.playing ? "running" : "paused";
  element.style.setProperty("--fig-play", play);
  element.dataset["figPlay"] = play;
  let active = true;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!active || !entries.some(visibleEnough)) return;
      playback.playing = true;
      element.style.setProperty("--fig-play", "running");
      element.dataset["figPlay"] = "running";
      observer.disconnect();
    },
    { threshold: [0, 0.05, 0.1, 0.15, 0.2, 0.25] },
  );
  if (!playback.playing) observer.observe(element);
  return () => {
    active = false;
    observer.disconnect();
    element.replaceChildren();
  };
}

function visibleEnough(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= 0.25) return true;
  const screen = entry.rootBounds?.height ?? 0;
  return screen > 0 && entry.intersectionRect.height >= screen * 0.25;
}

/** The open interaction acquires bytes. The last visible subscriber releases them on retention/unmount. */
export function createSvgViewer() {
  let src: string | null = null;
  const listeners = new Set<() => void>();
  const close = () => {
    if (src === null) return;
    URL.revokeObjectURL(src);
    src = null;
    for (const notify of listeners) notify();
  };
  return {
    getSnapshot: () => src,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) close();
      };
    },
    open: (markup: string) => {
      close();
      src = URL.createObjectURL(new Blob([markup], { type: SVG_CONTENT_TYPE }));
      for (const notify of listeners) notify();
    },
    close,
  };
}

function parseSvg(markup: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(markup, SVG_CONTENT_TYPE);
  const root = parsed.documentElement;
  return parsed.getElementsByTagName("parsererror").length === 0 &&
    root instanceof SVGSVGElement
    ? root
    : null;
}
