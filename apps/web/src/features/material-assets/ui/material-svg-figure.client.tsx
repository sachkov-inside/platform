"use client";

import { useQuery } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { hasText } from "@/shared/lib/text";
import { cn } from "@/shared/lib/utils";

import type { ViewerSize } from "../model/image-viewer-view";
import { MaterialImageDelivery } from "./material-image-delivery.client";
import { MaterialImageViewer } from "./material-image-viewer.client";
import {
  createSvgViewer,
  mountSvgFigure,
  readSvgFigure,
} from "./svg-figure.browser";
import { NARROW_SCREEN, zoomControlClassName } from "./zoom-control";

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
interface SvgFigureProps {
  readonly alt: string;
  readonly caption?: string | undefined;
  readonly height: number;
  readonly preview: boolean;
  readonly src: string;
  readonly srcSet: string;
  readonly viewerSize?: ViewerSize | undefined;
  readonly width: number;
}

export function MaterialSvgFigure(props: SvgFigureProps) {
  return <SvgFigureContent key={props.src} {...props} />;
}

function SvgFigureContent({
  alt,
  caption,
  height,
  preview,
  src,
  srcSet,
  viewerSize,
  width,
}: SvgFigureProps) {
  const instance = useId();
  const playback = useRef({ markup: null as string | null, playing: false });
  const query = useQuery({
    queryKey: ["material-svg-figure", instance, src],
    queryFn: ({ signal }) => readSvgFigure(src, signal),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const markup = query.data;
  const kind =
    markup === undefined ? "loading" : markup === null ? "image" : "inline";
  const [viewer] = useState(createSvgViewer);
  const viewerSrc = useSyncExternalStore(
    viewer.subscribe,
    viewer.getSnapshot,
    () => null,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const host = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null || markup === undefined || markup === null) return;
      return mountSvgFigure(element, markup, playback.current);
    },
    [markup],
  );

  if (kind === "image") {
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

  const zoomable = kind === "inline" && viewerSize !== undefined;
  const openViewer = () => {
    if (typeof markup === "string") viewer.open(markup);
  };
  const play: CSSProperties & Record<string, string> = {
    "--fig-play": "paused",
  };
  return (
    <div
      className={cn("relative", zoomable && "max-md:cursor-zoom-in")}
      data-svg-figure={kind === "inline" ? "inline" : "loading"}
      onClick={(event) => {
        // On a phone a scaled-down figure is hard to read: a tap opens it large. Wider screens
        // keep the click for selecting the figure's text.
        if (
          !zoomable ||
          (event.target instanceof Element &&
            event.target.closest("dialog") !== null) ||
          (event.target instanceof Node &&
            trigger.current?.contains(event.target) === true) ||
          !window.matchMedia(NARROW_SCREEN).matches
        )
          return;
        openViewer();
      }}
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
          data-fig-play="paused"
          ref={host}
          role={hasText(alt) ? "img" : undefined}
          style={play}
        />
      </div>
      {kind === "loading" ? (
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
          src={viewerSrc}
          alt={alt}
          caption={caption}
          height={viewerSize.height}
          onClose={() => {
            viewer.close();
            trigger.current?.focus();
          }}
          width={viewerSize.width}
        />
      ) : null}
    </div>
  );
}
