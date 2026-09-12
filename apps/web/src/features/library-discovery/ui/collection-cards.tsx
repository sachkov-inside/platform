import { ArrowRight, LockKeyhole, Play } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import {
  ContentCoverImage,
  materialPreviewHasVideo,
  type ContentCover,
  type MaterialPreview,
} from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";

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
  readonly continuation?: { readonly read: number; readonly total: number };
}

export function TopicCard({
  compact = false,
  returnHref,
  topic,
}: {
  readonly compact?: boolean;
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
      <span className="block">
        <ContentCoverImage
          alt=""
          className={cn(
            "aspect-square min-h-0 transition-transform duration-200 group-hover/topic:-translate-y-1 motion-reduce:transform-none motion-reduce:transition-none",
            compact ? "rounded-[1.15rem]" : "rounded-[1.35rem]",
          )}
          cover={topic.cover ?? null}
          fallbackKind="topic"
          fallbackSeed={topic.slug}
          sizes="(min-width: 1024px) 16rem, 50vw"
        />
      </span>
      <strong className={cn(
        "block tracking-[-0.02em]",
        compact ? "mt-2 text-sm leading-5" : "mt-3 text-[0.9375rem] leading-5 md:text-base md:leading-6",
      )}>
        {topic.name}
      </strong>
      {compact ? null : (
        <span className="mt-1 block text-xs font-medium text-muted-foreground">
          {formatMaterialCount(topic.count)}
        </span>
      )}
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
      aria-label={`${playlist.continuation === undefined ? "Открыть" : "Продолжить"} руководство ${playlist.name}`}
      className="group/playlist flex h-full min-w-0 flex-col overflow-hidden rounded-[2rem] bg-primary p-5 text-left text-white no-underline transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-ring motion-reduce:transform-none motion-reduce:transition-none"
      data-playlist-card
      // Начатое руководство продолжается в программе: там материалы и подсвеченное место чтения.
      // Непрочитанное открывается со страницы продукта, где руководство сначала рассказывает о себе.
      href={playlist.continuation === undefined ? collectionDiscoveryHref("series", playlist.slug, returnHref) : guideProgrammeHref(playlist.slug)}
      prefetch={false}
    >
      <span className="flex items-start justify-between gap-3">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold", playlist.continuation === undefined ? "bg-white/10 text-white/75" : "bg-accent text-accent-foreground")}>
          {playlist.continuation === undefined ? null : <Play aria-hidden="true" className="size-3 shrink-0 fill-current" />}
          <span>{playlist.continuation === undefined ? `Руководство · ${playlist.countLabel}` : `Продолжить · изучено ${String(playlist.continuation.read)} из ${String(playlist.continuation.total)}`}</span>
        </span>
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-foreground"
        >
          <ArrowRight className="size-4 transition-transform group-hover/playlist:translate-x-0.5 motion-reduce:transform-none" />
        </span>
      </span>
      <strong className="mt-4 block text-lg leading-6 tracking-[-0.035em] md:text-2xl md:leading-7">
        {playlist.name}
      </strong>
      <span className="mt-2 block text-sm leading-5 text-white/65">
        {playlist.summary || "Последовательность материалов"}
      </span>
      <span className="mt-auto grid grid-cols-3 gap-2 pt-6" aria-hidden="true">
        {Array.from({ length: Math.max(previews.length, 1) }, (_, index) => {
          const material = previews[index];
          const collectionCover = index === 0
            ? playlist.cover ?? null
            : null;
          const locked =
            collectionCover === null &&
            material?.availability !== undefined &&
            material.availability !== "available";
          return (
            <span className="relative block overflow-hidden rounded-2xl" key={material?.slug ?? `${playlist.slug}-${String(index)}`}>
              <span className={locked ? "block scale-[1.04] blur-[4px]" : "block"}>
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
                      ? material?.slug ?? `${playlist.slug}-${String(index)}`
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
