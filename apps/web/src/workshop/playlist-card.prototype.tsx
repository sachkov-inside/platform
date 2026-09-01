import { ArrowUpRight, ListVideo } from "lucide-react";
import Link from "next/link";

export interface PlaylistCardPresentation {
  readonly countLabel: string;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
}

/** Shared Storybook-only Playlist projection for discovery and Topic surfaces. */
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
    >
      <PlaylistArtwork />
      <span className="flex min-w-0 items-center justify-between gap-4 p-5">
        <span className="min-w-0">
          <span className="block text-lg font-semibold leading-6 tracking-[-0.025em]">
            {playlist.name}
          </span>
          <span className="mt-2 block text-sm leading-5 text-muted-foreground">
            {playlist.summary}
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

function PlaylistArtwork() {
  return (
    <span
      aria-hidden="true"
      className="relative grid min-h-32 place-items-center overflow-clip bg-sidebar text-sidebar-foreground"
    >
      <span className="absolute inset-x-5 top-5 h-px bg-sidebar-border" />
      <span className="absolute bottom-5 left-5 top-5 w-px bg-sidebar-border" />
      <span className="grid grid-cols-[repeat(3,2.75rem)] items-center gap-2">
        {["1", "2", "3"].map((step) => (
          <span
            className="relative grid size-11 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent font-mono text-xs text-sidebar-accent-foreground"
            key={step}
          >
            {step}
            {step === "3" ? null : (
              <span className="absolute left-full top-1/2 h-px w-2 bg-sidebar-primary" />
            )}
          </span>
        ))}
      </span>
      <ListVideo className="absolute bottom-5 right-5 size-5 text-sidebar-primary" />
    </span>
  );
}
