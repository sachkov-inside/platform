"use client";

import { useState } from "react";

/** Keep failed protected deliveries visible and retryable without reloading the article. */
export function MaterialImageDelivery({
  alt,
  height,
  preview,
  src,
  srcSet,
  width,
}: {
  readonly alt: string;
  readonly height: number;
  readonly preview: boolean;
  readonly src: string;
  readonly srcSet: string;
  readonly width: number;
}) {
  const [failed, setFailed] = useState(false);
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
      ) : (
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
            if (element?.complete && element.naturalWidth === 0)
              setFailed(true);
          }}
          sizes="(max-width: 48rem) calc(100vw - 2.5rem), 70ch"
          src={src}
          srcSet={srcSet}
          width={width}
        />
      )}
    </div>
  );
}
