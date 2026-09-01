import { FileText } from "lucide-react";

export function MaterialAssetImage({
  alt,
  assetId,
  caption,
  height,
  materialId,
  preview = false,
  variants,
  width,
}: {
  readonly alt: string;
  readonly assetId: string;
  readonly caption?: string | undefined;
  readonly height?: number | undefined;
  readonly materialId: string;
  readonly preview?: boolean;
  readonly variants?: readonly { readonly height: number; readonly width: number }[] | undefined;
  readonly width?: number | undefined;
}) {
  const responsiveVariants = variants ?? [];
  const available = responsiveVariants.at(-1);
  if (available === undefined || width === undefined || height === undefined) {
    return <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Изображение временно недоступно.</p>;
  }
  const query = preview ? "?preview=true" : "";
  const url = (variantWidth: number) =>
    `/api/materials/${encodeURIComponent(materialId)}/assets/${encodeURIComponent(assetId)}/images/${String(variantWidth)}${query}`;
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      {/* The stable same-origin route re-authorizes protected images; Next Image must not proxy it. */}
      {/* eslint-disable-next-line next/no-img-element -- the protected route requires the viewer's session and cannot pass through the Next optimizer */}
      <img
        alt={alt}
        className="h-auto w-full bg-muted object-contain"
        decoding="async"
        height={height}
        loading="lazy"
        sizes="(max-width: 48rem) calc(100vw - 2.5rem), 70ch"
        src={url(available.width)}
        srcSet={responsiveVariants.map((variant) => `${url(variant.width)} ${String(variant.width)}w`).join(", ")}
        width={width}
      />
      {caption === undefined ? null : (
        <figcaption className="border-t border-border px-4 py-3 text-sm text-muted-foreground">{caption}</figcaption>
      )}
    </figure>
  );
}

export function MaterialAssetFile({
  assetId,
  contentType,
  filename,
  label,
  materialId,
  preview = false,
  size,
}: {
  readonly assetId: string;
  readonly contentType?: string | undefined;
  readonly filename?: string | undefined;
  readonly label: string;
  readonly materialId: string;
  readonly preview?: boolean;
  readonly size?: number | undefined;
}) {
  const query = preview ? "?preview=true" : "";
  return (
    <a
      className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 no-underline transition-colors hover:bg-muted focus-visible:outline-ring motion-reduce:transition-none"
      href={`/api/materials/${encodeURIComponent(materialId)}/assets/${encodeURIComponent(assetId)}${query}`}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-accent"><FileText aria-hidden="true" className="size-5" /></span>
      <span className="min-w-0">
        <span className="block font-semibold text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[filename, contentType, size === undefined ? undefined : formatBytes(size)].filter(Boolean).join(" · ")}
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
