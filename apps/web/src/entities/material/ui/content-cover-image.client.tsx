"use client";

import {
  Bot,
  Boxes,
  Clapperboard,
  FileText,
  ListVideo,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { contentCoverUrl, type ContentCover } from "../model/content-cover";

type ContentCoverFallbackKind =
  | "material"
  | "note"
  | "playlist"
  | "topic"
  | "video";

export function ContentCoverImage({
  alt,
  className,
  cover,
  fallbackKind = "material",
  fallbackSeed = alt,
  sizes = "(min-width: 768px) 28rem, 100vw",
}: {
  readonly alt: string;
  readonly className?: string;
  readonly cover: ContentCover | null;
  readonly fallbackKind?: ContentCoverFallbackKind;
  readonly fallbackSeed?: string;
  readonly sizes?: string;
}) {
  const [failedCoverId, setFailedCoverId] = useState<string | null>(null);
  const renditions = [...(cover?.renditions ?? [])].sort(
    (left, right) => left.width - right.width,
  );
  const selected = renditions.at(-1);
  const showImage =
    cover !== null && selected !== undefined && failedCoverId !== cover.coverId;
  const FallbackIcon = fallbackIconByKind[fallbackKind];

  return (
    <span
      className={cn(
        "public-cover-grid relative grid overflow-hidden",
        fallbackToneClass(fallbackSeed),
        className,
      )}
    >
      {fallbackKind === "video" ? (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle_at_72%_25%,rgb(255_255_255/0.45),transparent_32%)]"
          />
          <FallbackIcon
            aria-hidden="true"
            className="absolute right-[12%] top-[18%] size-[42%] opacity-25"
            strokeWidth={1.2}
          />
        </>
      ) : (
        <span
          aria-hidden="true"
          className="relative m-auto grid size-20 rotate-[-5deg] place-items-center rounded-[1.4rem] border border-white/35 bg-white/78 text-[#202124] shadow-[0_1.5rem_3rem_-1.5rem_rgb(20_21_24/0.65)] backdrop-blur-sm"
        >
          <FallbackIcon className="size-10" strokeWidth={1.7} />
        </span>
      )}
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

const fallbackIconByKind: Readonly<Record<ContentCoverFallbackKind, LucideIcon>> = {
  material: Boxes,
  note: FileText,
  playlist: ListVideo,
  topic: Bot,
  video: Clapperboard,
};

function fallbackToneClass(seed: string): string {
  const tones = [
    "bg-[#dce9ff] text-[#205aa7]",
    "bg-[#ffdcd2] text-[#b83a25]",
    "bg-[#25272d] text-white",
    "bg-[#e9e1ff] text-[#5d43a4]",
    "bg-[#dcefe5] text-[#267057]",
    "bg-[#eee8dc] text-[#86663e]",
  ] as const;
  const value = Array.from(seed).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0,
    0,
  );
  return tones[value % tones.length] ?? tones[0];
}
