"use client";

import type { ImageVariants } from "@inside/material-blocks";
import { useEffect, useRef, useState } from "react";

import { MaterialImageDelivery } from "./material-image-delivery.client";
import type { ViewerSize } from "../model/image-viewer-view";

export interface MaterialImageSource {
  readonly height: number;
  readonly width: number;
  readonly src: string;
  readonly srcSet: string;
  readonly viewerSize?: ViewerSize | undefined;
}

/** At narrower article widths, the tall composition keeps diagram labels readable. */
const WIDE_IMAGE_COLUMN_PX = 560;

/** Reuses the accepted image delivery and viewer for the column's current composition and theme. */
export function MaterialResponsiveImage({
  alt,
  caption,
  image,
  imageVariants,
  preview,
}: {
  readonly alt: string;
  readonly caption?: string | undefined;
  readonly image: MaterialImageSource;
  readonly imageVariants?: ImageVariants<MaterialImageSource> | undefined;
  readonly preview: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [choice, setChoice] =
    useState<keyof ImageVariants<MaterialImageSource>>("wideLight");
  useEffect(() => {
    const element = container.current;
    if (element === null || imageVariants === undefined) return;
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const scheme = getComputedStyle(element).colorScheme;
      const dark =
        scheme === "dark" ||
        (scheme.includes("light") &&
          scheme.includes("dark") &&
          preference.matches);
      const wide =
        element.getBoundingClientRect().width >= WIDE_IMAGE_COLUMN_PX;
      setChoice(
        wide
          ? dark
            ? "wideDark"
            : "wideLight"
          : dark
            ? "tallDark"
            : "tallLight",
      );
    };
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const theme = new MutationObserver(update);
    for (
      let ancestor: HTMLElement | null = element;
      ancestor !== null;
      ancestor = ancestor.parentElement
    )
      theme.observe(ancestor, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    preference.addEventListener("change", update);
    update();
    return () => {
      resize.disconnect();
      theme.disconnect();
      preference.removeEventListener("change", update);
    };
  }, [imageVariants]);
  const selected = imageVariants?.[choice] ?? image;
  return (
    <div className="min-w-0 w-full" ref={container}>
      <MaterialImageDelivery
        key={selected.src}
        {...selected}
        alt={alt}
        caption={caption}
        preview={preview}
      />
    </div>
  );
}
