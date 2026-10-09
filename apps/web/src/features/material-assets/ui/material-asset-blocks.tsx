import type {
  ImageAssetPresentation,
  ImageVariants,
} from "@inside/material-blocks";
import {
  MaterialResponsiveImage,
  type MaterialImageSource,
} from "./material-responsive-image.client";
import { materialAssetFileHref } from "../api/material-asset-file-href";
import { FileText } from "lucide-react";

export function MaterialAssetImage({
  alt,
  assetId,
  caption,
  contentVersion,
  displayWidthPercent = 100,
  height,
  imageVariants,
  materialId,
  preview = false,
  variants,
  width,
  zoomable = true,
}: {
  readonly alt: string;
  readonly assetId: string;
  readonly caption?: string | undefined;
  readonly contentVersion: number;
  readonly displayWidthPercent?: number | undefined;
  readonly height?: number | undefined;
  readonly imageVariants?: ImageVariants<ImageAssetPresentation> | undefined;
  readonly materialId: string;
  readonly preview?: boolean;
  readonly variants?:
    readonly { readonly height: number; readonly width: number }[] | undefined;
  readonly width?: number | undefined;
  /** The authoring canvas selects the image on click instead of opening the viewer. */
  readonly zoomable?: boolean;
}) {
  const responsiveVariants = variants ?? [];
  const available = responsiveVariants.at(-1);
  if (available === undefined || width === undefined || height === undefined) {
    return (
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        Изображение временно недоступно.
      </p>
    );
  }
  const query = new URLSearchParams({ contentVersion: String(contentVersion) });
  if (preview) query.set("preview", "true");
  const source = (
    asset: ImageAssetPresentation,
  ): MaterialImageSource | undefined => {
    const largest = asset.variants?.at(-1);
    if (
      largest === undefined ||
      asset.width === undefined ||
      asset.height === undefined
    )
      return undefined;
    const url = (variantWidth: number) =>
      `/api/materials/${encodeURIComponent(materialId)}/assets/${encodeURIComponent(asset.assetId)}/images/${String(variantWidth)}?${query.toString()}`;
    return {
      height: asset.height,
      width: asset.width,
      src: url(largest.width),
      srcSet: (asset.variants ?? [])
        .map((variant) => `${url(variant.width)} ${String(variant.width)}w`)
        .join(", "),
      viewerSize: zoomable ? largest : undefined,
    };
  };
  const image = source({
    assetId,
    height,
    width,
    variants: responsiveVariants,
  });
  const wideLight =
    imageVariants === undefined ? undefined : source(imageVariants.wideLight);
  const wideDark =
    imageVariants === undefined ? undefined : source(imageVariants.wideDark);
  const tallLight =
    imageVariants === undefined ? undefined : source(imageVariants.tallLight);
  const tallDark =
    imageVariants === undefined ? undefined : source(imageVariants.tallDark);
  const sources =
    wideLight !== undefined &&
    wideDark !== undefined &&
    tallLight !== undefined &&
    tallDark !== undefined
      ? { wideLight, wideDark, tallLight, tallDark }
      : undefined;
  if (
    image === undefined ||
    (imageVariants !== undefined && sources === undefined)
  )
    return <p role="status">Изображение временно недоступно.</p>;
  return (
    <figure
      style={{ width: `${String(displayWidthPercent)}%` }}
      className="mx-auto overflow-hidden rounded-xl bg-card"
    >
      <MaterialResponsiveImage
        alt={alt}
        caption={caption}
        image={image}
        imageVariants={sources}
        preview={preview}
      />
      {caption === undefined ? null : (
        <figcaption className="px-2 py-2 text-center text-sm text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function MaterialAssetFile({
  assetId,
  contentType,
  contentVersion,
  filename,
  label,
  materialId,
  preview = false,
  size,
}: {
  readonly assetId: string;
  readonly contentType?: string | undefined;
  readonly contentVersion: number;
  readonly filename?: string | undefined;
  readonly label: string;
  readonly materialId: string;
  readonly preview?: boolean;
  readonly size?: number | undefined;
}) {
  return (
    <a
      className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 no-underline transition-colors hover:bg-muted focus-visible:outline-ring motion-reduce:transition-none"
      href={materialAssetFileHref({
        materialId,
        assetId,
        contentVersion,
        preview,
      })}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-accent">
        <FileText aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[
            filename,
            contentType,
            size === undefined ? undefined : formatBytes(size),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </a>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
