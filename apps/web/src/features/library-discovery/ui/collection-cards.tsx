import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import {
  ContentCoverImage,
  type ContentCover,
  type MaterialPreview,
} from "@/entities/material";

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

export function TopicCard({ topic }: { readonly topic: TopicCardPresentation }) {
  return (
    <Link
      className="group/topic relative isolate min-h-64 overflow-clip rounded-2xl bg-sidebar text-sidebar-foreground no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-sidebar-ring motion-reduce:transform-none motion-reduce:transition-none"
      data-topic-card
      href={`/topics/${topic.slug}`}
      prefetch={false}
    >
      <ContentCoverImage
        alt=""
        className="absolute inset-0"
        cover={topic.cover ?? null}
        sizes="(min-width: 1024px) 24rem, (min-width: 640px) 50vw, 100vw"
      />
      <span className="absolute inset-x-0 bottom-0 z-10 bg-sidebar/95 p-5 sm:p-6">
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block max-w-[24ch] text-xl font-semibold leading-[1.18] tracking-[-0.03em]">
              {topic.name}
            </span>
            <span className="mt-2 block max-w-[50ch] text-sm leading-5 text-sidebar-foreground/70">
              {topic.summary || "Материалы по теме"}
            </span>
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="size-5 shrink-0 text-sidebar-primary transition-transform group-hover/topic:-translate-y-0.5 group-hover/topic:translate-x-0.5 motion-reduce:transform-none"
          />
        </span>
        <span className="mt-4 block text-xs text-sidebar-foreground/58">
          {formatMaterialCount(topic.count)}
        </span>
      </span>
    </Link>
  );
}

export function PlaylistCard({
  playlist,
}: {
  readonly playlist: PlaylistCardPresentation;
}) {
  return (
    <Link
      className="group/playlist grid min-h-32 overflow-clip rounded-2xl bg-secondary text-foreground no-underline shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-ring motion-reduce:transform-none motion-reduce:transition-none @min-[34rem]/playlist-surface:grid-cols-[9rem_minmax(0,1fr)]"
      data-playlist-card
      href={`/series/${playlist.slug}`}
      prefetch={false}
    >
      <ContentCoverImage
        alt=""
        className="min-h-32"
        cover={playlist.cover ?? null}
        sizes="9rem"
      />
      <span className="flex min-w-0 items-center justify-between gap-4 p-5">
        <span className="min-w-0">
          <span className="block text-lg font-semibold leading-6 tracking-[-0.025em]">
            {playlist.name}
          </span>
          <span className="mt-2 block text-sm leading-5 text-muted-foreground">
            {playlist.summary || "Последовательность материалов"}
          </span>
          <span className="mt-3 block text-xs text-muted-foreground">
            {playlist.countLabel}
          </span>
          {(playlist.previewItems?.length ?? 0) > 0 ? (
            <span className="mt-3 grid gap-1 text-xs text-muted-foreground">
              {playlist.previewItems?.slice(0, 3).map((item) => (
                <span className="truncate" key={item.slug}>
                  {item.title}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-5 shrink-0 text-accent transition-transform group-hover/playlist:-translate-y-0.5 group-hover/playlist:translate-x-0.5 motion-reduce:transform-none"
        />
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
