"use client";

import { ImageIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { contentCoverUrl, type ContentCover } from "../model/content-cover";

export function ContentCoverImage({
  alt,
  className,
  cover,
  sizes = "(min-width: 768px) 28rem, 100vw",
}: {
  readonly alt: string;
  readonly className?: string;
  readonly cover: ContentCover | null;
  readonly sizes?: string;
}) {
  const [failedCoverId, setFailedCoverId] = useState<string | null>(null);
  const renditions = [...(cover?.renditions ?? [])].sort(
    (left, right) => left.width - right.width,
  );
  const selected = renditions.at(-1);
  const showImage =
    cover !== null && selected !== undefined && failedCoverId !== cover.coverId;

  return (
    <span
      className={cn(
        "relative grid overflow-hidden bg-[linear-gradient(135deg,var(--sidebar)_0%,var(--sidebar-accent)_65%,var(--accent)_140%)] text-sidebar-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-0 opacity-45 [background-image:linear-gradient(var(--sidebar-border)_1px,transparent_1px),linear-gradient(90deg,var(--sidebar-border)_1px,transparent_1px)] [background-size:2.5rem_2.5rem]" />
      <ImageIcon aria-hidden="true" className="relative m-auto size-8 text-sidebar-primary/80" />
      {showImage ? (
        // The backend already produces the exact responsive WebP renditions used by this srcSet.
        // oxlint-disable-next-line next/no-img-element
        <img
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          decoding="async"
          height={selected.height}
          loading="lazy"
          onError={() => {
            setFailedCoverId(cover.coverId);
          }}
          sizes={sizes}
          src={contentCoverUrl(cover.coverId, selected.width)}
          srcSet={renditions
            .map(
              (rendition) =>
                `${contentCoverUrl(cover.coverId, rendition.width)} ${String(rendition.width)}w`,
            )
            .join(", ")}
          width={selected.width}
        />
      ) : null}
    </span>
  );
}
