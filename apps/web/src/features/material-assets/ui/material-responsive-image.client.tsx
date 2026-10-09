"use client";

import type { ImageVariants } from "@inside/material-blocks";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import styles from "./material-responsive-image.module.css";

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
  const [choice, setChoice] = useState<
    keyof ImageVariants<MaterialImageSource> | undefined
  >(undefined);
  useEffect(() => {
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
        {selected === undefined ? null : (
          <MaterialImageDelivery
            key={selected.src}
            {...selected}
            alt={alt}
            caption={caption}
            preview={preview}
          />
        )}
      </div>
    </div>
  );
}
