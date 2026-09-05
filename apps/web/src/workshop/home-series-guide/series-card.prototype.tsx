// #290 proof: accepted PlaylistCard composition with the confirmed public label Series.
import { ArrowRight, LockKeyhole } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import {
  ContentCoverImage,
  materialPreviewHasVideo,
} from "@/entities/material";
import type { PlaylistCardPresentation as SeriesCardPresentation } from "@/features/library-discovery";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
export function SeriesCard({
  playlist,
  returnHref,
}: {
  readonly playlist: SeriesCardPresentation;
  readonly returnHref?: Route;
}) {
  const previews = playlist.previewItems?.slice(0, 3) ?? [];

  return (
    <Link
      aria-label={`Открыть серию ${playlist.name}`}
      className="group/playlist flex h-full min-w-0 flex-col overflow-hidden rounded-[2rem] bg-primary p-5 text-left text-white no-underline transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-ring motion-reduce:transform-none motion-reduce:transition-none"
      data-playlist-card
      href={collectionDiscoveryHref("series", playlist.slug, returnHref)}
      prefetch={false}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="inline-flex rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/75">
          Серия · {playlist.countLabel}
        </span>
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-foreground"
        >
          <ArrowRight className="size-4 transition-transform group-hover/playlist:translate-x-0.5 motion-reduce:transform-none" />
        </span>
      </span>
      <strong className="mt-4 block text-xl leading-6 tracking-[-0.035em] md:text-2xl md:leading-7">
        {playlist.name}
      </strong>
      <span className="mt-2 block text-sm leading-5 text-white/65">
        {playlist.summary || "Последовательность материалов"}
      </span>
      <span className="mt-auto grid grid-cols-3 gap-2 pt-6" aria-hidden="true">
        {Array.from({ length: Math.max(previews.length, 1) }, (_, index) => {
          const material = previews[index];
          const collectionCover = index === 0 ? (playlist.cover ?? null) : null;
          const locked =
            collectionCover === null &&
            material?.availability !== undefined &&
            material.availability !== "available";
          return (
            <span
              className="relative block overflow-hidden rounded-2xl"
              key={material?.slug ?? `${playlist.slug}-${String(index)}`}
            >
              <span
                className={locked ? "block scale-[1.04] blur-[4px]" : "block"}
              >
                <ContentCoverImage
                  alt=""
                  className="aspect-[4/3] min-h-0 rounded-2xl"
                  cover={collectionCover ?? material?.cover ?? null}
                  fallbackKind={
                    collectionCover !== null
                      ? "playlist"
                      : material === undefined
                        ? "playlist"
                        : materialPreviewHasVideo(material)
                          ? "video"
                          : "material"
                  }
                  fallbackSeed={
                    collectionCover === null
                      ? (material?.slug ?? `${playlist.slug}-${String(index)}`)
                      : playlist.slug
                  }
                  sizes="10rem"
                />
              </span>
              {locked ? (
                <span className="absolute inset-0 grid place-items-center bg-white/20">
                  <span className="grid size-8 place-items-center rounded-full bg-white/92 text-accent shadow-xl backdrop-blur-xl">
                    <LockKeyhole className="size-4" />
                  </span>
                </span>
              ) : null}
            </span>
          );
        })}
      </span>
    </Link>
  );
}
