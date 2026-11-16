import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";

import type { MaterialPrimaryVideo as SiteVideo } from "@/features/material-video/ui/material-primary-video.client";
import { MaterialVideoPlayerView } from "@/features/material-video/ui/material-primary-video.client";

export {
  MaterialVideoPlayerView,
  type MaterialVideoPlayerViewProps,
  type PlayerPhase,
} from "@/features/material-video/ui/material-primary-video.client";

/**
 * The preview stands in for `@/features/material-video`. The site plays a lesson video through a
 * playback session the backend opens with the Kinescope key; the preview has neither, so it shows
 * the site's player frame and chapters with the video's Kinescope ID in place of the player.
 */
export function MaterialPrimaryVideo({
  className,
  video,
}: ComponentProps<typeof SiteVideo>) {
  const sectionRef = useRef<HTMLElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setMount(
      sectionRef.current?.querySelector<HTMLElement>(
        "[data-video-player-mount]",
      ) ?? null,
    );
  }, []);
  return (
    <>
      <MaterialVideoPlayerView
        sectionRef={sectionRef}
        phase="playing"
        title={video.title}
        videoId={video.videoId}
        description={video.description}
        chapters={video.chapters ?? []}
        onLoad={() => undefined}
        showWatchedAction={false}
        {...(className === undefined ? {} : { className })}
      />
      {mount === null
        ? null
        : createPortal(
            <div
              className="grid size-full place-items-center bg-[radial-gradient(circle_at_70%_20%,color-mix(in_oklch,var(--accent)_18%,transparent),transparent_42%),linear-gradient(145deg,var(--sidebar),color-mix(in_oklch,var(--sidebar)_84%,black))] p-6 text-center"
              data-file-preview-video={video.videoId}
            >
              <div className="max-w-md">
                <p className="text-sm font-semibold">Видео Kinescope</p>
                <p className="mt-2 break-all font-mono text-xs text-sidebar-foreground/80">
                  {video.videoId}
                </p>
                <p className="mt-3 text-sm leading-6 text-sidebar-foreground/80">
                  Плеер работает на стенде и на сайте: ему нужен ключ Kinescope
                  на сервере.
                </p>
              </div>
            </div>,
            mount,
          )}
    </>
  );
}
