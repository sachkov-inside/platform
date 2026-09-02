"use client";

import { Link2, LoaderCircle, RefreshCw, Upload, Video } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

import {
  attachMaterialVideo,
  initMaterialVideoUpload,
  reconcileMaterialVideo,
  type MaterialVideo,
  type VideoMutationResult,
} from "../api/video-authoring.browser";
import {
  clearBrowserVideoUploadAttempt,
  getOrCreateBrowserVideoUploadAttempt,
  type BrowserVideoUploadAttempt,
} from "../api/video-upload-attempt.browser";
import { startResumableVideoUpload } from "../api/video-upload-transfer.browser";

export function MaterialVideoAuthoring({
  access,
  disabled,
  materialId,
  onChange,
  primaryVideoId,
}: {
  readonly access: "free" | "membership";
  readonly disabled: boolean;
  readonly materialId: string | null;
  readonly onChange: (videoId: string | null) => void;
  readonly primaryVideoId: string | null;
}) {
  const uploadAttempt = useRef<BrowserVideoUploadAttempt | null>(null);
  const [providerVideoId, setProviderVideoId] = useState("");
  const [video, setVideo] = useState<MaterialVideo | null>(null);
  const [phase, setPhase] = useState<MaterialVideoAuthoringPhase>(
    primaryVideoId === null ? "idle" : "ready",
  );
  const [progress, setProgress] = useState(0);
  const { mutateAsync: uploadVideo } = useMutation({ mutationFn: initMaterialVideoUpload });
  const { mutateAsync: attachVideo } = useMutation({ mutationFn: attachMaterialVideo });
  const { mutateAsync: reconcileVideo } = useMutation({ mutationFn: reconcileMaterialVideo });

  const applyVideoResult = useCallback((result: VideoMutationResult<MaterialVideo>) => {
    if (result.kind !== "ready") {
      setPhase("error");
      return;
    }
    setVideo(result.value);
    if (result.value.state === "ready") {
      if (uploadAttempt.current?.videoId === result.value.videoId) {
        clearBrowserVideoUploadAttempt(uploadAttempt.current);
        uploadAttempt.current = null;
      }
      onChange(result.value.videoId);
      setPhase("ready");
    } else {
      setPhase(result.value.state === "failed" ? "error" : "processing");
    }
  }, [onChange]);

  const reconcile = useCallback(async (videoId: string) => {
    setPhase("processing");
    applyVideoResult(await reconcileVideo({ videoId }));
  }, [applyVideoResult, reconcileVideo]);

  useEffect(() => {
    if (
      materialId === null ||
      phase !== "processing" ||
      video === null ||
      video.state === "ready" ||
      video.state === "failed"
    ) return;
    const timer = window.setTimeout(() => { void reconcile(video.videoId); }, 5_000);
    return () => { window.clearTimeout(timer); };
  }, [materialId, phase, reconcile, video]);

  if (materialId === null) {
    return (
      <p className="mt-3 rounded-xl bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
        Сначала сохраните новый Material, затем добавьте основное видео.
      </p>
    );
  }

  const upload = async (file: File) => {
    setPhase("uploading");
    setProgress(0);
    const browserAttempt = await getOrCreateBrowserVideoUploadAttempt(materialId, file);
    uploadAttempt.current = browserAttempt;
    const initialized = await uploadVideo({
      access,
      byteSize: file.size,
      filename: file.name,
      materialId,
      submissionId: browserAttempt.submissionId,
      title: file.name.replace(/\.[^.]+$/u, ""),
    });
    if (initialized.kind !== "ready") {
      setPhase("error");
      return;
    }
    uploadAttempt.current = { ...browserAttempt, videoId: initialized.value.video.videoId };
    setVideo(initialized.value.video);
    if (new URL(initialized.value.uploadEndpoint).hostname.endsWith(".invalid")) {
      setProgress(100);
      await reconcile(initialized.value.video.videoId);
      return;
    }
    await startResumableVideoUpload({
      file,
      onError: () => { setPhase("error"); },
      onProgress: (sent, total) => { setProgress(Math.round((sent / total) * 100)); },
      onSuccess: () => { void reconcile(initialized.value.video.videoId); },
      uploadUrl: initialized.value.uploadEndpoint,
    });
  };

  const attach = async () => {
    setPhase("processing");
    applyVideoResult(await attachVideo({
      access,
      materialId,
      providerVideoId,
    }));
  };

  const activeVideoId = video?.videoId ?? primaryVideoId;
  return <MaterialVideoAuthoringView
    access={access}
    activeVideoId={activeVideoId}
    disabled={disabled}
    onAttach={() => { void attach(); }}
    onFileSelected={(file) => { void upload(file); }}
    onProviderVideoIdChange={setProviderVideoId}
    onReconcile={() => {
      if (activeVideoId !== null) void reconcile(activeVideoId);
    }}
    onRemove={() => {
      setVideo(null);
      setPhase("idle");
      onChange(null);
    }}
    phase={phase}
    progress={progress}
    providerVideoId={providerVideoId}
    title={video?.title ?? null}
  />;
}

export type MaterialVideoAuthoringPhase = "idle" | "uploading" | "processing" | "ready" | "error";

export interface MaterialVideoAuthoringViewProps {
  readonly access: "free" | "membership";
  readonly activeVideoId: string | null;
  readonly disabled: boolean;
  readonly onAttach: () => void;
  readonly onFileSelected: (file: File) => void;
  readonly onProviderVideoIdChange: (value: string) => void;
  readonly onReconcile: () => void;
  readonly onRemove: () => void;
  readonly phase: MaterialVideoAuthoringPhase;
  readonly progress: number;
  readonly providerVideoId: string;
  readonly title: string | null;
}

/** Production presentation boundary shared with Storybook state fixtures. */
export function MaterialVideoAuthoringView({
  access,
  activeVideoId,
  disabled,
  onAttach,
  onFileSelected,
  onProviderVideoIdChange,
  onReconcile,
  onRemove,
  phase,
  progress,
  providerVideoId,
  title,
}: MaterialVideoAuthoringViewProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="mt-4 grid gap-4 rounded-2xl bg-muted/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-accent"><Video aria-hidden="true" className="size-5" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title ?? (activeVideoId === null ? "Основное видео не выбрано" : "Основное видео привязано")}</p>
            <p aria-live="polite" className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">
              {phase === "uploading" ? `Загрузка ${String(progress)}%` : phase === "processing" ? "Kinescope обрабатывает видео" : phase === "error" ? "Нужна повторная попытка" : phase === "ready" ? "Готово к Save" : "Видео хранится отдельно от body Material"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            accept="video/*"
            aria-label="Видео для загрузки"
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file !== undefined) onFileSelected(file);
            }}
            ref={fileInput}
            type="file"
          />
          <Button disabled={disabled || phase === "uploading"} onClick={() => fileInput.current?.click()} size="sm" type="button" variant="outline">
            <Upload aria-hidden="true" />Загрузить
          </Button>
          {activeVideoId === null ? null : (
            <Button disabled={disabled || phase === "uploading"} onClick={onReconcile} size="sm" type="button" variant="outline">
              <RefreshCw aria-hidden="true" />Проверить
            </Button>
          )}
          {activeVideoId === null ? null : (
            <Button disabled={disabled} onClick={onRemove} size="sm" type="button" variant="ghost">Убрать</Button>
          )}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="grid gap-1.5 text-xs font-medium" htmlFor="provider-video-id">
          ID существующего видео из Kinescope project «{access === "membership" ? "Для участников" : "Публичный"}»
          <input
            className="h-10 min-w-0 rounded-xl border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={disabled}
            id="provider-video-id"
            onChange={(event) => { onProviderVideoIdChange(event.currentTarget.value); }}
            value={providerVideoId}
          />
        </label>
        <Button className="self-end" disabled={disabled || providerVideoId.trim().length === 0 || phase === "processing"} onClick={onAttach} type="button" variant="secondary">
          {phase === "processing" ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Link2 aria-hidden="true" />}
          Привязать
        </Button>
      </div>
    </div>
  );
}
