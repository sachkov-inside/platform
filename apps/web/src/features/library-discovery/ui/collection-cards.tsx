import { ArrowUpRight, ListVideo } from "lucide-react";
import Link from "next/link";

export interface TopicCardPresentation {
  readonly count: number;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
}

export interface PlaylistCardPresentation {
  readonly countLabel: string;
  readonly name: string;
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
      <TopicArtwork slug={topic.slug} />
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
        <span className="mt-4 block font-mono text-[0.6875rem] text-sidebar-foreground/58">
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
      <PlaylistArtwork />
      <span className="flex min-w-0 items-center justify-between gap-4 p-5">
        <span className="min-w-0">
          <span className="block text-lg font-semibold leading-6 tracking-[-0.025em]">
            {playlist.name}
          </span>
          <span className="mt-2 block text-sm leading-5 text-muted-foreground">
            {playlist.summary || "Последовательность материалов"}
          </span>
          <span className="mt-3 block font-mono text-[0.6875rem] text-muted-foreground">
            {playlist.countLabel}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-5 shrink-0 text-accent transition-transform group-hover/playlist:-translate-y-0.5 group-hover/playlist:translate-x-0.5 motion-reduce:transform-none"
        />
      </span>
    </Link>
  );
}

function TopicArtwork({ slug }: { readonly slug: string }) {
  const labels = topicLabels(slug);
  return (
    <span aria-hidden="true" className="absolute inset-0 overflow-clip bg-sidebar">
      <span className="absolute inset-x-8 top-7 h-px bg-sidebar-border" />
      <span className="absolute bottom-0 left-10 top-0 w-px bg-sidebar-border/75" />
      <span className="absolute right-8 top-6 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-sidebar-foreground/70">
        тема
      </span>
      <span className="absolute left-8 right-8 top-16 grid grid-cols-3 items-center gap-2">
        {labels.map((label, index) => (
          <span
            className="relative grid min-h-14 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent px-2 text-center font-mono text-[0.6875rem] leading-4 text-sidebar-accent-foreground"
            key={label}
          >
            {label}
            {index < labels.length - 1 ? (
              <span className="absolute left-full top-1/2 h-px w-2 bg-sidebar-primary" />
            ) : null}
          </span>
        ))}
      </span>
    </span>
  );
}

function PlaylistArtwork() {
  return (
    <span aria-hidden="true" className="relative grid min-h-32 place-items-center overflow-clip bg-sidebar text-sidebar-foreground">
      <span className="absolute inset-x-5 top-5 h-px bg-sidebar-border" />
      <span className="absolute bottom-5 left-5 top-5 w-px bg-sidebar-border" />
      <span className="grid grid-cols-3 items-center gap-2">
        {["1", "2", "3"].map((step) => (
          <span className="relative grid size-9 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent font-mono text-xs text-sidebar-accent-foreground" key={step}>
            {step}
            {step === "3" ? null : <span className="absolute left-full top-1/2 h-px w-2 bg-sidebar-primary" />}
          </span>
        ))}
      </span>
      <ListVideo className="absolute bottom-5 right-5 size-5 text-sidebar-primary" />
    </span>
  );
}

function topicLabels(slug: string): readonly [string, string, string] {
  const parts = slug.split("-").filter(Boolean);
  return [parts[0] ?? "знать", parts[1] ?? "понять", parts[2] ?? "применить"];
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
