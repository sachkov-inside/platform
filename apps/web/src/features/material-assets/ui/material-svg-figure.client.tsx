"use client";

import {
  checkInlineSvgMarkup,
  SVG_CONTENT_TYPE,
} from "@inside/material-blocks/svg-image";
import { Maximize2 } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { hasText } from "@/shared/lib/text";
import { cn } from "@/shared/lib/utils";

import type { ViewerSize } from "../model/image-viewer-view";
import { MaterialImageDelivery } from "./material-image-delivery.client";
import { MaterialImageViewer } from "./material-image-viewer.client";
import { NARROW_SCREEN, zoomControlClassName } from "./zoom-control";

/**
 * The figure starts its animation once this share of it, or of the screen height for a figure
 * taller than the screen, is visible (#2041).
 */
const PLAY_VISIBLE_SHARE = 0.25;
const PLAY_THRESHOLDS = [0, 0.05, 0.1, 0.15, 0.2, PLAY_VISIBLE_SHARE];

type FigureState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "inline"; markup: string; svg: SVGSVGElement }>
  | Readonly<{ kind: "image" }>;

/**
 * Puts a checked SVG Material image into the page (#2041): its text stays text, selectable and
 * found by page search, and its animation waits until the reader reaches it.
 *
 * - The bytes come from the same protected address as the `<img>`. The browser checks them again
 *   with the upload allowlist and the figure scope rules of `checkInlineSvgMarkup` before anything
 *   enters the page.
 * - Isolation: every selector of the figure starts with its own `fig-…` id, so its CSS reaches no
 *   page element, and its id rules outweigh the page's element and class rules. The markup is
 *   part of the page's DOM, not a shadow root: WebKit's find in page skips shadow trees.
 * - The layer around the figure contains layout and paint: even a rule on the figure's root, such
 *   as `position: fixed`, cannot draw outside its frame or cover the page.
 * - The host sets `--fig-play`: `paused` until the figure is visible enough, then `running`.
 *   The figure generator's contract has each animated rule read it through
 *   `var(--fig-play, running)`; no check enforces it, and a figure without it simply plays at once.
 * - The host carries `role="img"` and the ALT as its accessible name.
 *
 * When the bytes cannot be read or do not pass the checks, the figure falls back to `<img>`.
 */
export function MaterialSvgFigure({
  alt,
  caption,
  height,
  preview,
  src,
  srcSet,
  viewerSize,
  width,
}: {
  readonly alt: string;
  readonly caption?: string | undefined;
  readonly height: number;
  readonly preview: boolean;
  readonly src: string;
  readonly srcSet: string;
  readonly viewerSize?: ViewerSize | undefined;
  readonly width: number;
}) {
  const [figure, setFigure] = useState<FigureState>({ kind: "loading" });
  const [playing, setPlaying] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void prepareFigure(src, controller.signal).then((prepared) => {
      if (controller.signal.aborted) return;
      setFigure(
        prepared === null ? { kind: "image" } : { kind: "inline", ...prepared },
      );
    });
    return () => {
      controller.abort();
    };
  }, [src]);

  useEffect(() => {
    const element = host.current;
    if (figure.kind !== "inline" || element === null) return;
    const svg = document.importNode(figure.svg, true);
    // The host is the one accessible image: its ALT names the figure. Page search and selection
    // still reach the text of a hidden subtree.
    svg.setAttribute("aria-hidden", "true");
    element.replaceChildren(svg);
    return () => {
      element.replaceChildren();
    };
  }, [figure]);

  useEffect(() => {
    const element = frame.current;
    if (figure.kind !== "inline" || element === null || playing) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(visibleEnough)) {
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: PLAY_THRESHOLDS },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [figure.kind, playing]);

  useEffect(() => {
    // Focus returns once the viewer has closed: while it is modal the page cannot take focus.
    if (viewerSrc !== null || !returnFocus.current) return;
    returnFocus.current = false;
    trigger.current?.focus();
  }, [viewerSrc]);

  useEffect(
    () => () => {
      if (viewerSrc !== null) URL.revokeObjectURL(viewerSrc);
    },
    [viewerSrc],
  );

  if (figure.kind === "image") {
    return (
      <MaterialImageDelivery
        alt={alt}
        caption={caption}
        height={height}
        preview={preview}
        src={src}
        srcSet={srcSet}
        viewerSize={viewerSize}
        width={width}
      />
    );
  }

  const zoomable = figure.kind === "inline" && viewerSize !== undefined;
  const openViewer = () => {
    if (figure.kind !== "inline") return;
    setViewerSrc(
      URL.createObjectURL(
        new Blob([figure.markup], { type: SVG_CONTENT_TYPE }),
      ),
    );
  };
  const play: CSSProperties & Record<string, string> = {
    "--fig-play": playing ? "running" : "paused",
  };
  return (
    <div
      className={cn("relative", zoomable && "max-md:cursor-zoom-in")}
      data-svg-figure={figure.kind === "inline" ? "inline" : "loading"}
      onClick={(event) => {
        // On a phone a scaled-down figure is hard to read: a tap opens it large. Wider screens
        // keep the click for selecting the figure's text.
        if (
          !zoomable ||
          (event.target instanceof Node &&
            trigger.current?.contains(event.target) === true) ||
          !window.matchMedia(NARROW_SCREEN).matches
        )
          return;
        openViewer();
      }}
      ref={frame}
      style={{ aspectRatio: `${String(width)} / ${String(height)}` }}
    >
      <div
        className="absolute inset-0 z-0 overflow-hidden"
        style={{ contain: "strict" }}
      >
        <div
          aria-hidden={hasText(alt) ? undefined : true}
          aria-label={hasText(alt) ? alt : undefined}
          className="size-full [&>svg]:block [&>svg]:size-full"
          data-fig-play={playing ? "running" : "paused"}
          ref={host}
          role={hasText(alt) ? "img" : undefined}
          style={play}
        />
      </div>
      {figure.kind === "loading" ? (
        // Without JavaScript the server's HTML still shows the figure as an image.
        <noscript>
          {/* oxlint-disable-next-line next/no-img-element -- The protected route needs the viewer's session. */}
          <img
            alt={alt}
            className="absolute inset-0 size-full"
            height={height}
            src={src}
            width={width}
          />
        </noscript>
      ) : null}
      {zoomable ? (
        <button
          aria-haspopup="dialog"
          aria-label={
            hasText(alt)
              ? `Открыть изображение крупно: ${alt}`
              : "Открыть изображение крупно"
          }
          className={zoomControlClassName}
          onClick={openViewer}
          ref={trigger}
          title="Открыть крупно"
          type="button"
        >
          <Maximize2 aria-hidden="true" className="size-4" />
        </button>
      ) : null}
      {viewerSrc !== null && viewerSize !== undefined ? (
        <MaterialImageViewer
          alt={alt}
          caption={caption}
          height={viewerSize.height}
          onClose={() => {
            returnFocus.current = true;
            setViewerSrc(null);
          }}
          src={viewerSrc}
          width={viewerSize.width}
        />
      ) : null}
    </div>
  );
}

/**
 * The checked SVG behind `src`, or `null` when it cannot be shown inline: the bytes are unreadable
 * or fail the checks, or the browser has no visibility observer.
 */
async function prepareFigure(
  src: string,
  signal: AbortSignal,
): Promise<{ readonly markup: string; readonly svg: SVGSVGElement } | null> {
  if (typeof IntersectionObserver !== "function") return null;
  try {
    const response = await fetch(src, { credentials: "same-origin", signal });
    if (!response.ok) return null;
    const checked = checkInlineSvgMarkup(await response.text());
    if (!checked.ok) return null;
    const svg = parseSvg(checked.value.markup);
    return svg === null ? null : { markup: checked.value.markup, svg };
  } catch {
    // Not a dependency failure to report: the figure falls back to `<img>`, which owns retry.
    return null;
  }
}

/** Parses checked markup as XML: no script runs, and the root must be an SVG element. */
function parseSvg(markup: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(markup, SVG_CONTENT_TYPE);
  const root = parsed.documentElement;
  return parsed.getElementsByTagName("parsererror").length === 0 &&
    root instanceof SVGSVGElement
    ? root
    : null;
}

function visibleEnough(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= PLAY_VISIBLE_SHARE) return true;
  const screen = entry.rootBounds?.height ?? 0;
  return (
    screen > 0 && entry.intersectionRect.height >= screen * PLAY_VISIBLE_SHARE
  );
}
