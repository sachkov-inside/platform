"use client";

import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { hasText } from "@/shared/lib/text";

import type { ViewerSize } from "../model/image-viewer-view";
import { MaterialImageViewer } from "./material-image-viewer.client";

/**
 * Keep failed protected deliveries visible and retryable without reloading the article. With
 * `viewerSize`, a click opens `src` — the largest variant of that size — in a full-screen viewer.
 */
export function MaterialImageDelivery({
  alt,
  caption,
  height,
  preview,
  src,
  srcSet,
  width,
  viewerSize,
}: {
  readonly alt: string;
  readonly caption?: string | undefined;
  readonly height: number;
  readonly preview: boolean;
  readonly src: string;
  readonly srcSet: string;
  readonly width: number;
  readonly viewerSize?: ViewerSize | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    // Фокус возвращается после того, как окно просмотра закрылось: пока оно модальное,
    // остальная страница недоступна для фокуса.
    if (viewing || !returnFocus.current) return;
    returnFocus.current = false;
    trigger.current?.focus();
  }, [viewing]);
  const image = (
    // oxlint-disable-next-line next/no-img-element -- The protected route needs the viewer's session.
    <img
      alt={alt}
      className="h-auto w-full bg-muted object-contain"
      decoding="async"
      height={height}
      loading={preview ? "eager" : "lazy"}
      onError={() => {
        setFailed(true);
      }}
      ref={(element) => {
        // A server-rendered image may fail before React attaches onError.
        if (element?.complete === true && element.naturalWidth === 0)
          setFailed(true);
      }}
      sizes="(max-width: 48rem) calc(100vw - 2.5rem), 70ch"
      src={src}
      srcSet={srcSet}
      width={width}
    />
  );
  return (
    <div
      className="relative"
      style={{ aspectRatio: `${String(width)} / ${String(height)}` }}
    >
      {failed ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-auto bg-muted p-3 text-center text-sm text-muted-foreground"
          role="status"
        >
          <span>Не удалось загрузить изображение.</span>
          <button
            className="rounded px-2 py-1 text-foreground underline"
            onClick={() => {
              setFailed(false);
            }}
            type="button"
          >
            Загрузить снова
          </button>
        </div>
      ) : viewerSize !== undefined ? (
        <button
          aria-haspopup="dialog"
          aria-label={
            hasText(alt)
              ? `Открыть изображение крупно: ${alt}`
              : "Открыть изображение крупно"
          }
          className="group block w-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          onClick={() => {
            setViewing(true);
          }}
          ref={trigger}
          type="button"
        >
          {image}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-background/85 text-foreground shadow-card transition-opacity duration-(--motion-duration-fast) motion-reduce:transition-none md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100"
          >
            <Maximize2 className="size-4" />
          </span>
        </button>
      ) : (
        image
      )}
      {viewing && viewerSize !== undefined ? (
        <MaterialImageViewer
          alt={alt}
          caption={caption}
          height={viewerSize.height}
          onClose={() => {
            returnFocus.current = true;
            setViewing(false);
          }}
          src={src}
          width={viewerSize.width}
        />
      ) : null}
    </div>
  );
}
