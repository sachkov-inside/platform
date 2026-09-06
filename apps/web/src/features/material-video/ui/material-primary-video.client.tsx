"use client";

import { CheckCircle2, LoaderCircle, RotateCcw, VideoOff } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { type Ref, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import {
  createMaterialVideoPlaybackSession,
  saveMaterialVideoProgress,
} from "../api/video-playback.browser";
import {
  isVideoWatchedPosition,
  resolveVideoPlaybackProgress,
} from "../model/video";

interface MaterialPrimaryVideoProps {
  readonly className?: string;
  readonly materialId: string;
  readonly video: {
    readonly durationSeconds?: number | undefined;
    readonly failureCode?: string | undefined;
    readonly state: "uploading" | "processing" | "ready" | "failed";
    readonly title: string;
    readonly videoId: string;
  };
}

export type PlayerPhase = "loading" | "playing" | "error";

export function MaterialPrimaryVideo({ className, materialId, video }: MaterialPrimaryVideoProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const progressInteractionRef = useRef(false);
  const progressContextRef = useRef<{
    readonly durationSeconds: number;
    readonly scope: "account" | "anonymous";
  } | null>(null);
  const [phase, setPhase] = useState<PlayerPhase>("loading");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [measuredDuration, setMeasuredDuration] = useState<number | null>(null);
  const anonymousWatched = useSyncExternalStore(subscribeAnonymousProgress, () => {
    const positionSeconds = readAnonymousProgress(video.videoId);
    return video.durationSeconds !== undefined &&
      positionSeconds !== null &&
      isVideoWatchedPosition(positionSeconds, video.durationSeconds);
  }, () => false);
  const [watchedOverride, setWatchedOverride] = useState<boolean | null>(null);
  const watched = watchedOverride ?? anonymousWatched;
  const [watchedPending, setWatchedPending] = useState(false);
  const { mutateAsync: createPlaybackSession } = useMutation({ mutationFn: createMaterialVideoPlaybackSession });
  const { mutate: persistAccountProgress, mutateAsync: persistAccountProgressAsync } = useMutation({ mutationFn: saveMaterialVideoProgress });

  useEffect(() => {
    if (video.state !== "ready") return;
    let active = true;
    let mountedPlayer: { destroy(): Promise<void> } | null = null;
    const loadPlayer = async () => {
      try {
        const session = await createPlaybackSession({ materialId, videoId: video.videoId });
        if (!active) return;
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
        const savedPositionSeconds = session.progressScope === "anonymous"
          ? readAnonymousProgress(video.videoId) ?? session.resumeSeconds
          : session.resumeSeconds;
        const iframeApi = await import("@kinescope/player-iframe-api-loader");
        if (!active) return;
        const factory = await iframeApi.load();
        if (!active) return;
        const player = await factory.create(mount, {
          behavior: {
            autoPlay: false,
            keyboard: true,
            localStorage: false,
            playsInline: true,
            preload: "metadata",
          },
          size: { height: "100%", width: "100%" },
          ui: { controls: true, fullscreenButton: true, language: "ru" },
          url: source.toString(),
        });
        if (!active) {
          await player.destroy();
          return;
        }
        mountedPlayer = player;
        const iframe = mount.querySelector("iframe");
        iframe?.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
        iframe?.setAttribute("allowfullscreen", "true");
        iframe?.setAttribute("title", video.title);
        const duration = Math.max(1, Math.round(await player.getDuration()));
        if (!active) return;
        const playbackProgress = resolveVideoPlaybackProgress(savedPositionSeconds, duration);
        const resumeSeconds = playbackProgress.resumeSeconds;
        if (resumeSeconds !== null && resumeSeconds > 5) {
          await player.seekTo(resumeSeconds);
        }
        if (!active) return;
        setMeasuredDuration(duration);
        progressContextRef.current = {
          durationSeconds: duration,
          scope: session.progressScope,
        };
        if (!progressInteractionRef.current) setWatchedOverride(playbackProgress.watched);
        let lastPersisted = resumeSeconds ?? 0;
        let currentTime = resumeSeconds ?? 0;
        const persist = (position: number) => {
          if (!active) return;
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
        player.on(player.Events.Ended, () => {
          if (!active) return;
          persist(duration);
          setWatchedOverride(true);
        });
        setPhase("playing");
      } catch {
        if (active) {
          void mountedPlayer?.destroy();
          mountedPlayer = null;
          setPhase("error");
        }
      }
    };
    void loadPlayer();
    return () => {
      active = false;
      void mountedPlayer?.destroy();
    };
  }, [createPlaybackSession, materialId, persistAccountProgress, retryAttempt, video.state, video.title, video.videoId]);

  if (video.state !== "ready") {
    return (
      <UnavailableVideoState
        video={video}
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  const toggleWatched = async () => {
    if (watchedPending) return;
    progressInteractionRef.current = true;
    setWatchedPending(true);
    try {
      let context = progressContextRef.current;
      if (context === null) {
        const session = await createPlaybackSession({ materialId, videoId: video.videoId });
        if (session === null || session.videoId !== video.videoId || video.durationSeconds === undefined) {
          return;
        }
        context = {
          durationSeconds: video.durationSeconds,
          scope: session.progressScope,
        };
        progressContextRef.current = context;
      }
      const positionSeconds = watched ? 0 : context.durationSeconds;
      if (context.scope === "anonymous") {
        writeAnonymousProgress(video.videoId, positionSeconds, context.durationSeconds);
        setWatchedOverride(!watched);
        return;
      }
      const saved = await persistAccountProgressAsync({
        durationSeconds: context.durationSeconds,
        materialId,
        positionSeconds,
        videoId: video.videoId,
      });
      if (saved) setWatchedOverride(!watched);
    } finally {
      setWatchedPending(false);
    }
  };

  return <MaterialVideoPlayerView
    onLoad={() => { setPhase("loading"); setRetryAttempt((attempt) => attempt + 1); }}
    onToggleWatched={() => { void toggleWatched(); }}
    {...(className === undefined ? {} : { className })}
    phase={phase}
    sectionRef={sectionRef}
    title={video.title}
    videoId={video.videoId}
    watched={watched}
    watchedDisabled={
      watchedPending ||
      (video.durationSeconds === undefined && measuredDuration === null)
    }
  />;
}

export interface MaterialVideoPlayerViewProps {
  readonly className?: string;
  readonly onLoad: () => void;
  readonly onToggleWatched?: () => void;
  readonly phase: PlayerPhase;
  readonly sectionRef?: Ref<HTMLElement>;
  readonly title: string;
  readonly videoId: string;
  readonly watched?: boolean;
  readonly watchedDisabled?: boolean;
}

/** Production player shell shared with Storybook state fixtures. */
export function MaterialVideoPlayerView({
  className,
  onLoad,
  onToggleWatched,
  phase,
  sectionRef,
  title,
  videoId,
  watched = false,
  watchedDisabled = false,
}: MaterialVideoPlayerViewProps) {
  return (
    <section aria-labelledby="primary-video-heading" className={cn("mt-8 max-w-[56rem] sm:mt-10", className)} data-video-id={videoId} ref={sectionRef}>
      <h2 className="sr-only" id="primary-video-heading">Видео: {title}</h2>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground shadow-card ring-1 ring-sidebar-border">
        <div className="absolute inset-0" data-video-player-mount />
        {phase === "playing" ? null : (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_70%_20%,color-mix(in_oklch,var(--accent)_18%,transparent),transparent_42%),linear-gradient(145deg,var(--sidebar),color-mix(in_oklch,var(--sidebar)_84%,black))] p-3 text-center sm:p-6">
            <div className="max-w-md">
              {phase === "loading" ? (
                <LoaderCircle aria-hidden="true" className="mx-auto size-7 animate-spin motion-reduce:animate-none" />
              ) : null}
              <p aria-live="polite" className="mt-3 text-sm leading-6 text-sidebar-foreground/80">
                {phase === "loading" ? "Загружаем видео…" : "Не удалось загрузить видео"}
              </p>
              {phase === "error" ? (
                <Button className="mt-3" onClick={onLoad} type="button">
                  <RotateCcw aria-hidden="true" /> Повторить
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          aria-pressed={watched}
          className="h-auto min-h-10 w-[13.5rem] max-w-full shrink-0 justify-center whitespace-normal rounded-full py-2"
          disabled={watchedDisabled || onToggleWatched === undefined}
          onClick={onToggleWatched}
          type="button"
          variant={watched ? "default" : "outline"}
        >
          <CheckCircle2 aria-hidden="true" />
          {watched ? "Просмотрено" : "Отметить просмотренным"}
        </Button>
      </div>
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
        {processing ? "Можно продолжить чтение и вернуться к видео позже." : "Текст материала остаётся доступен. Попробуйте открыть видео позже."}
      </p>
    </section>
  );
}

const anonymousProgressKey = (videoId: string) => `inside.video-progress.v1:${videoId}`;

function subscribeAnonymousProgress(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => { window.removeEventListener("storage", onStoreChange); };
}

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
