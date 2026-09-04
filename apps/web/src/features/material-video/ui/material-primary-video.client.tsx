"use client";

import { LoaderCircle, Play, RotateCcw, VideoOff } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { type Ref, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import {
  createMaterialVideoPlaybackSession,
  saveMaterialVideoProgress,
} from "../api/video-playback.browser";

interface MaterialPrimaryVideoProps {
  readonly className?: string;
  readonly materialId: string;
  readonly video: {
    readonly failureCode?: string | undefined;
    readonly state: "uploading" | "processing" | "ready" | "failed";
    readonly title: string;
    readonly videoId: string;
  };
}

export type PlayerPhase = "idle" | "loading" | "playing" | "error";

export function MaterialPrimaryVideo({ className, materialId, video }: MaterialPrimaryVideoProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const playerRef = useRef<{ destroy(): Promise<void> } | null>(null);
  const [phase, setPhase] = useState<PlayerPhase>("idle");
  const { mutateAsync: createPlaybackSession } = useMutation({ mutationFn: createMaterialVideoPlaybackSession });
  const { mutate: persistAccountProgress } = useMutation({ mutationFn: saveMaterialVideoProgress });

  useEffect(() => () => {
    void playerRef.current?.destroy();
  }, []);

  if (video.state !== "ready") {
    return (
      <UnavailableVideoState
        video={video}
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  const loadPlayer = async () => {
    if (phase === "loading" || phase === "playing") return;
    setPhase("loading");
    try {
      const session = await createPlaybackSession({ materialId, videoId: video.videoId });
      if (session === null || session.videoId !== video.videoId) {
        throw new Error("Playback session is unavailable");
      }
      const mount = sectionRef.current?.querySelector<HTMLElement>("[data-video-player-mount]") ?? null;
      if (mount === null) throw new Error("Player mount is unavailable");
      const source = new URL(session.embedLocator);
      source.searchParams.set("dnt", "1");
      if (session.drmAuthToken !== null) {
        source.searchParams.set("drmauthtoken", session.drmAuthToken);
      }
      const resumeSeconds = session.progressScope === "anonymous"
        ? readAnonymousProgress(video.videoId) ?? session.resumeSeconds
        : session.resumeSeconds;
      const iframeApi = await import("@kinescope/player-iframe-api-loader");
      const factory = await iframeApi.load();
      const player = await factory.create(mount, {
        behavior: {
          autoPlay: false,
          keyboard: true,
          localStorage: false,
          playsInline: true,
          preload: "none",
        },
        size: { height: "100%", width: "100%" },
        ui: { controls: true, fullscreenButton: true, language: "ru" },
        url: source.toString(),
      });
      playerRef.current = player;
      const iframe = mount.querySelector("iframe");
      iframe?.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
      iframe?.setAttribute("allowfullscreen", "true");
      iframe?.setAttribute("title", video.title);
      if (resumeSeconds !== null && resumeSeconds > 5) {
        await player.seekTo(resumeSeconds);
      }
      const duration = Math.max(1, Math.round(await player.getDuration()));
      let lastPersisted = resumeSeconds ?? 0;
      let currentTime = resumeSeconds ?? 0;
      const persist = (position: number) => {
        const rounded = Math.max(0, Math.min(duration, Math.round(position)));
        lastPersisted = rounded;
        if (session.progressScope === "anonymous") {
          writeAnonymousProgress(video.videoId, rounded, duration);
          return;
        }
        persistAccountProgress({
          durationSeconds: duration,
          materialId,
          positionSeconds: rounded,
          videoId: video.videoId,
        });
      };
      player.on(player.Events.TimeUpdate, ({ data: { currentTime: nextTime } }) => {
        currentTime = nextTime;
        if (Math.abs(currentTime - lastPersisted) >= 15) persist(currentTime);
      });
      player.on(player.Events.Pause, () => { persist(currentTime); });
      player.on(player.Events.Ended, () => { persist(0); });
      setPhase("playing");
    } catch {
      setPhase("error");
    }
  };

  return <MaterialVideoPlayerView
    onLoad={() => { void loadPlayer(); }}
    {...(className === undefined ? {} : { className })}
    phase={phase}
    sectionRef={sectionRef}
    title={video.title}
    videoId={video.videoId}
  />;
}

export interface MaterialVideoPlayerViewProps {
  readonly className?: string;
  readonly onLoad: () => void;
  readonly phase: PlayerPhase;
  readonly sectionRef?: Ref<HTMLElement>;
  readonly title: string;
  readonly videoId: string;
}

/** Production player shell shared with Storybook state fixtures. */
export function MaterialVideoPlayerView({
  className,
  onLoad,
  phase,
  sectionRef,
  title,
  videoId,
}: MaterialVideoPlayerViewProps) {
  return (
    <section aria-labelledby="primary-video-heading" className={cn("mt-8 max-w-[56rem] sm:mt-10", className)} data-video-id={videoId} ref={sectionRef}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-[-0.02em]" id="primary-video-heading">
          Видео
        </h2>
        <span className="font-mono text-[0.6875rem] text-muted-foreground">Kinescope · DNT</span>
      </div>
      <p className="mb-3 text-sm font-semibold leading-5 sm:hidden">{title}</p>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground shadow-card ring-1 ring-sidebar-border">
        <div className="absolute inset-0" data-video-player-mount />
        {phase === "playing" ? null : (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_70%_20%,color-mix(in_oklch,var(--accent)_18%,transparent),transparent_42%),linear-gradient(145deg,var(--sidebar),color-mix(in_oklch,var(--sidebar)_84%,black))] p-3 text-center sm:p-6">
            <div className="max-w-md">
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm sm:size-14 sm:rounded-2xl">
                {phase === "loading" ? <LoaderCircle aria-hidden="true" className="size-6 animate-spin motion-reduce:animate-none" /> : <Play aria-hidden="true" className="size-6 fill-current" />}
              </span>
              <p className="mt-5 hidden text-balance text-lg font-semibold sm:block">{title}</p>
              <p aria-live="polite" className="mt-2 hidden text-sm leading-6 text-sidebar-foreground/70 sm:block">
                {phase === "loading"
                  ? "Проверяем доступ и загружаем player…"
                  : phase === "error"
                    ? "Player сейчас недоступен. Можно безопасно повторить."
                    : "Player подключится только после вашего действия."}
              </p>
              <Button
                className="mt-3 sm:mt-5"
                disabled={phase === "loading"}
                onClick={onLoad}
                type="button"
              >
                {phase === "error" ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
                {phase === "error" ? "Повторить" : "Загрузить player"}
              </Button>
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 max-w-[70ch] text-xs leading-5 text-muted-foreground">
        Управление, keyboard shortcuts, fullscreen и Picture-in-Picture предоставляет Kinescope. Субтитры для этого выпуска не заявлены.
      </p>
    </section>
  );
}

function UnavailableVideoState({ className, video }: { readonly className?: string; readonly video: MaterialPrimaryVideoProps["video"] }) {
  const processing = video.state === "uploading" || video.state === "processing";
  return (
    <section aria-labelledby="primary-video-heading" className={cn("mt-8 max-w-[56rem] rounded-2xl bg-secondary px-5 py-6 sm:mt-10 sm:px-7", className)} data-video-id={video.videoId}>
      <span className="grid size-11 place-items-center rounded-xl bg-background text-accent">
        {processing ? <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" /> : <VideoOff aria-hidden="true" className="size-5" />}
      </span>
      <h2 className="mt-4 text-lg font-semibold" id="primary-video-heading">
        {processing ? "Видео обрабатывается" : "Видео временно недоступно"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {processing ? "Можно продолжить чтение и вернуться к player позже." : "Текст материала остаётся доступен. Мы сохранили provider error без раскрытия технических данных."}
      </p>
    </section>
  );
}

const anonymousProgressKey = (videoId: string) => `inside.video-progress.v1:${videoId}`;

function readAnonymousProgress(videoId: string): number | null {
  try {
    const parsed = z.object({
      positionSeconds: z.number().int().nonnegative(),
      version: z.literal(1),
      videoId: z.literal(videoId),
    }).loose().safeParse(JSON.parse(localStorage.getItem(anonymousProgressKey(videoId)) ?? "null"));
    return parsed.success ? parsed.data.positionSeconds : null;
  } catch {
    return null;
  }
}

function writeAnonymousProgress(videoId: string, positionSeconds: number, durationSeconds: number): void {
  try {
    localStorage.setItem(anonymousProgressKey(videoId), JSON.stringify({
      durationSeconds,
      positionSeconds,
      version: 1,
      videoId,
    }));
  } catch {
    // Resume is best-effort when storage is unavailable.
  }
}
