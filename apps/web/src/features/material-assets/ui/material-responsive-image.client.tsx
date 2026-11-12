"use client";

import type { ImageFormat, ImageVariants } from "@inside/material-blocks";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import styles from "./material-responsive-image.module.css";

import { MaterialImageDelivery } from "./material-image-delivery.client";
import { MaterialSvgFigure } from "./material-svg-figure.client";
import type { ViewerSize } from "../model/image-viewer-view";

export interface MaterialImageSource {
  /** `"svg"`: the figure's markup goes into the page instead of an `<img>` (#2041). */
  readonly format?: ImageFormat | undefined;
  readonly height: number;
  readonly width: number;
  readonly src: string;
  readonly srcSet: string;
  readonly viewerSize?: ViewerSize | undefined;
}

/** At narrower article widths, the tall composition keeps diagram labels readable. */
const WIDE_IMAGE_COLUMN_PX = 560;

/**
 * Reuses the accepted image delivery and viewer for the column's current composition and theme.
 * An SVG composition goes into the page as markup; a wide/tall SVG pair names one file in both
 * theme keys, so only the column width changes it.
 */
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
  const [choice, setChoice] = useState<
    keyof ImageVariants<MaterialImageSource> | undefined
  >(undefined);
  // The composition depends on the actual column and inherited local theme. Select it before
  // the first hydrated paint, without downloading an incorrect server-side default first.
  useLayoutEffect(() => {
    const element = container.current;
    if (element === null || imageVariants === undefined) return;
    const update = () => {
      const dark =
        getComputedStyle(element).getPropertyValue("--theme-is-dark").trim() ===
        "1";
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
    update();
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [imageVariants]);
  const selected =
    imageVariants === undefined
      ? image
      : choice === undefined
        ? undefined
        : imageVariants[choice];
  const ratios: (CSSProperties & Record<string, string>) | undefined =
    imageVariants === undefined
      ? undefined
      : {
          "--wide-light-width": String(imageVariants.wideLight.width),
          "--wide-light-height": String(imageVariants.wideLight.height),
          "--wide-dark-width": String(imageVariants.wideDark.width),
          "--wide-dark-height": String(imageVariants.wideDark.height),
          "--tall-light-width": String(imageVariants.tallLight.width),
          "--tall-light-height": String(imageVariants.tallLight.height),
          "--tall-dark-width": String(imageVariants.tallDark.width),
          "--tall-dark-height": String(imageVariants.tallDark.height),
        };
  return (
    <div className={styles["container"]} ref={container} style={ratios}>
      <div
        data-image-composition={
          imageVariants === undefined ? undefined : "variants"
        }
        className={
          imageVariants === undefined ? undefined : styles["composition"]
        }
      >
        {selected === undefined ? null : selected.format === "svg" ? (
          <MaterialSvgFigure
            key={selected.src}
            alt={alt}
            caption={caption}
            height={selected.height}
            preview={preview}
            src={selected.src}
            srcSet={selected.srcSet}
            viewerSize={selected.viewerSize}
            width={selected.width}
          />
        ) : (
          <MaterialImageDelivery
            key={selected.src}
            alt={alt}
            caption={caption}
            height={selected.height}
            preview={preview}
            src={selected.src}
            srcSet={selected.srcSet}
            viewerSize={selected.viewerSize}
            width={selected.width}
          />
        )}
      </div>
    </div>
  );
}
