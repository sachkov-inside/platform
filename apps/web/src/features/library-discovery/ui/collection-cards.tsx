import { ArrowRight, LockKeyhole } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import {
  ContentCoverImage,
  type ContentCover,
  type MaterialPreview,
} from "@/entities/material";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";

export interface TopicCardPresentation {
  readonly cover?: ContentCover | null | undefined;
  readonly count: number;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
}

export interface PlaylistCardPresentation {
  readonly cover?: ContentCover | null | undefined;
  readonly countLabel: string;
  readonly name: string;
  readonly previewItems?: readonly MaterialPreview[] | undefined;
  readonly slug: string;
  readonly summary: string;
}

export function TopicCard({
  returnHref,
  topic,
}: {
  readonly returnHref?: Route;
  readonly topic: TopicCardPresentation;
}) {
  return (
    <Link
      aria-label={`Открыть тему ${topic.name}`}
      className="group/topic min-w-0 text-left no-underline"
      data-topic-card
      href={collectionDiscoveryHref("topic", topic.slug, returnHref)}
      prefetch={false}
    >
      <span className="relative block">
        <ContentCoverImage
          alt=""
          className="aspect-square min-h-0 rounded-[1.5rem] transition-transform duration-200 group-hover/topic:-translate-y-1 motion-reduce:transform-none motion-reduce:transition-none"
          cover={topic.cover ?? null}
          fallbackKind="topic"
          fallbackSeed={topic.slug}
          sizes="(min-width: 1024px) 16rem, 50vw"
        />
        <span className="absolute right-3 top-3 rounded-full bg-white/75 px-2.5 py-1 text-[0.625rem] font-bold text-[#202124] backdrop-blur-sm">
          {topic.count}
        </span>
      </span>
      <strong className="mt-3 block text-[0.9375rem] leading-5 tracking-[-0.02em] md:text-lg md:leading-6">
        {topic.name}
      </strong>
      <span className="mt-1 block text-xs font-medium text-[#5f5e59]">
        {formatMaterialCount(topic.count)}
      </span>
    </Link>
  );
}

export function PlaylistCard({
  playlist,
  returnHref,
}: {
  readonly playlist: PlaylistCardPresentation;
  readonly returnHref?: Route;
}) {
  const previews = playlist.previewItems?.slice(0, 3) ?? [];

  return (
    <Link
      aria-label={`Открыть плейлист ${playlist.name}`}
      className="group/playlist block min-w-0 overflow-hidden rounded-[2rem] bg-[#202124] p-5 text-left text-white no-underline transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-ring motion-reduce:transform-none motion-reduce:transition-none"
      data-playlist-card
      href={collectionDiscoveryHref("series", playlist.slug, returnHref)}
      prefetch={false}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="inline-flex rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/75">
          Плейлист · {playlist.countLabel}
        </span>
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[#202124]"
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
      <span className="mt-6 grid grid-cols-3 gap-2" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => {
          const material = previews[index];
          const locked = material?.availability !== undefined && material.availability !== "available";
          return (
            <span className="relative block overflow-hidden rounded-2xl" key={material?.slug ?? `${playlist.slug}-${String(index)}`}>
              <span className={locked ? "block scale-[1.04] blur-[4px]" : "block"}>
                <ContentCoverImage
                  alt=""
                  className="aspect-[4/3] min-h-0 rounded-2xl"
                  cover={material?.cover ?? (index === 0 ? playlist.cover ?? null : null)}
                  fallbackKind={materialKind(material)}
                  fallbackSeed={material?.slug ?? `${playlist.slug}-${String(index)}`}
                  sizes="10rem"
                />
              </span>
              {locked ? (
                <span className="absolute inset-0 grid place-items-center bg-white/20">
                  <span className="grid size-8 place-items-center rounded-full bg-white/92 text-[#c7461e] shadow-xl backdrop-blur-xl">
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

function materialKind(
  material: MaterialPreview | undefined,
): "material" | "playlist" | "video" {
  if (material === undefined) return "playlist";
  return material.formatSlug === "video" ||
    material.primaryVideoDurationSeconds !== undefined ||
    material.preview !== undefined
    ? "video"
    : "material";
}

export function formatMaterialCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14
      ? "материалов"
      : mod10 === 1
        ? "материал"
        : mod10 >= 2 && mod10 <= 4
          ? "материала"
          : "материалов";
  return `${String(count)} ${noun}`;
}
