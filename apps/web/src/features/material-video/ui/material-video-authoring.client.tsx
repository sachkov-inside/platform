"use client";

import {
  Link2,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePendingUploadGuard } from "@/shared/lib/autosave/use-autosave";
import { Button } from "@/shared/ui/button";

import {
  attachMaterialVideo,
  initMaterialVideoUpload,
  reconcileMaterialVideo,
  retryMaterialVideoDeletion,
  type VideoMutationResult,
} from "../api/video-authoring.browser";
import {
  clearBrowserVideoUploadAttempt,
  getOrCreateBrowserVideoUploadAttempt,
  type BrowserVideoUploadAttempt,
} from "../api/video-upload-attempt.browser";
import {
  startResumableVideoUpload,
  type ResumableVideoUpload,
} from "../api/video-upload-transfer.browser";
import {
  phaseForReconciledVideo,
  phaseForVideo,
  resolveInitialVideoAuthoring,
  type MaterialAuthoringVideo,
  type MaterialVideo,
  type MaterialVideoAuthoringPhase,
} from "../model/video";

const VIDEO_RECONCILIATION_POLL_INTERVAL_MILLISECONDS = 5_000;

export function MaterialVideoAuthoring({
  access,
  deleteVideoId,
  disabled,
  latestVideoDeletion,
  materialId,
  onChange,
  primaryVideo,
  unselectedUpload,
}: {
  readonly access: "free" | "membership";
  readonly deleteVideoId: string | null;
  readonly disabled: boolean;
  readonly latestVideoDeletion: MaterialAuthoringVideo | null;
  readonly materialId: string | null;
  readonly onChange: (
    primaryVideo: MaterialAuthoringVideo | null,
    deleteVideoId: string | null,
  ) => void;
  readonly primaryVideo: MaterialAuthoringVideo | null;
  readonly unselectedUpload: MaterialAuthoringVideo | null;
}) {
  const operation = useRef(0);
  const uploadAttempt = useRef<BrowserVideoUploadAttempt | null>(null);
  const uploadTransfer = useRef<Promise<ResumableVideoUpload | null> | null>(
    null,
  );
  useEffect(
    () => () => {
      operation.current += 1;
      void uploadTransfer.current
        ?.then((transfer) => transfer?.abort(false))
        .catch(() => undefined);
    },
    [],
  );
  const [providerVideoId, setProviderVideoId] = useState("");
  const [initial] = useState(() =>
    resolveInitialVideoAuthoring({ primaryVideo, unselectedUpload }),
  );
  const [recoveredVideoId, setRecoveredVideoId] = useState(initial.recoveredVideoId);
  const [video, setVideo] = useState<MaterialAuthoringVideo | null>(initial.video);
  const [deletionVideo, setDeletionVideo] =
    useState<MaterialAuthoringVideo | null>(latestVideoDeletion);
  const [observedDeletion, setObservedDeletion] = useState(latestVideoDeletion);
  if (observedDeletion !== latestVideoDeletion) {
    setObservedDeletion(latestVideoDeletion);
    setDeletionVideo(latestVideoDeletion);
  }
  const [phase, setPhase] = useState<MaterialVideoAuthoringPhase>(initial.phase);
  usePendingUploadGuard(phase === "uploading" || phase === "processing");
  const [progress, setProgress] = useState(0);
  const { mutateAsync: uploadVideo } = useMutation({
    mutationFn: initMaterialVideoUpload,
  });
  const { mutateAsync: attachVideo } = useMutation({
    mutationFn: attachMaterialVideo,
  });
  const { mutateAsync: reconcileVideo } = useMutation({
    mutationFn: reconcileMaterialVideo,
  });
  const { mutateAsync: retryDeletion } = useMutation({
    mutationFn: retryMaterialVideoDeletion,
  });

  const latestOnChange = useRef(onChange);
  useEffect(() => {
    latestOnChange.current = onChange;
  });

  const applyVideoResult = useCallback(
    (result: VideoMutationResult<MaterialVideo>) => {
      if (result.kind !== "ready") {
        setPhase("error");
        return;
      }
      if (isDeletionState(result.value.state)) {
        setDeletionVideo(result.value);
        return;
      }
      setVideo(result.value);
      const next = phaseForReconciledVideo(result.value, recoveredVideoId);
      if (next === "ready") {
        if (uploadAttempt.current?.videoId === result.value.videoId) {
          clearBrowserVideoUploadAttempt(uploadAttempt.current);
          uploadAttempt.current = null;
        }
        uploadTransfer.current = null;
        setRecoveredVideoId(null);
        latestOnChange.current(result.value, deleteVideoId);
      }
      setPhase(next);
    },
    [deleteVideoId, recoveredVideoId],
  );

  const reconcile = useCallback(
    async (videoId: string) => {
      const revision = operation.current;
      const targetIsDeletion = deletionVideo?.videoId === videoId;
      if (!targetIsDeletion) setPhase("processing");
      const result = await reconcileVideo({ videoId });
      if (revision !== operation.current) return;
      if (targetIsDeletion) {
        if (result.kind === "ready" && isDeletionState(result.value.state)) {
          setDeletionVideo(result.value);
        }
        return;
      }
      applyVideoResult(result);
    },
    [applyVideoResult, deletionVideo?.videoId, reconcileVideo],
  );

  useEffect(() => {
    if (
      materialId === null ||
      phase !== "processing" ||
      video === null ||
      video.state === "ready" ||
      video.state === "failed"
    )
      return;
    const timer = window.setTimeout(() => {
      void reconcile(video.videoId);
    }, VIDEO_RECONCILIATION_POLL_INTERVAL_MILLISECONDS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [materialId, phase, reconcile, video]);

  useEffect(() => {
    if (
      deletionVideo === null ||
      (deletionVideo.state !== "deletion_requested" &&
        deletionVideo.state !== "deleting")
    )
      return;
    const timer = window.setInterval(() => {
      void reconcile(deletionVideo.videoId);
    }, VIDEO_RECONCILIATION_POLL_INTERVAL_MILLISECONDS);
    return () => {
      window.clearInterval(timer);
    };
  }, [deletionVideo, reconcile]);

  if (materialId === null) {
    return (
      <p className="mt-3 rounded-xl bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
        Введите название — черновик сохранится автоматически, и можно будет
        добавить видео.
      </p>
    );
  }

  const upload = async (file: File) => {
    const revision = ++operation.current;
    setPhase("uploading");
    setRecoveredVideoId(null);
    setProgress(0);
    const browserAttempt = await getOrCreateBrowserVideoUploadAttempt(
      materialId,
      file,
    );
    uploadAttempt.current = browserAttempt;
    const initialized = await uploadVideo({
      access,
      byteSize: file.size,
      filename: file.name,
      materialId,
      submissionId: browserAttempt.submissionId,
      title: file.name.replace(/\.[^.]+$/u, ""),
    });
    if (revision !== operation.current) return;
    if (initialized.kind !== "ready") {
      if (initialized.kind === "upload_not_authorized") {
        clearBrowserVideoUploadAttempt(browserAttempt);
        uploadAttempt.current = null;
      }
      setPhase(initialized.kind === "unavailable" ? "error" : initialized.kind);
      return;
    }
    uploadAttempt.current = {
      ...browserAttempt,
      videoId: initialized.value.video.videoId,
    };
    setVideo(initialized.value.video);
    if (
      new URL(initialized.value.uploadEndpoint).hostname.endsWith(".invalid")
    ) {
      setProgress(100);
      await reconcile(initialized.value.video.videoId);
      return;
    }
    const transfer = startResumableVideoUpload({
      file,
      onError: () => {
        if (revision !== operation.current) return;
        setPhase("error");
      },
      onProgress: (sent, total) => {
        if (revision !== operation.current) return;
        setProgress(Math.round((sent / total) * 100));
      },
      onSuccess: () => {
        if (revision !== operation.current) return;
        void reconcile(initialized.value.video.videoId);
      },
      uploadUrl: initialized.value.uploadEndpoint,
    });
    uploadTransfer.current = transfer;
    await transfer;
  };

  const attach = async () => {
    const revision = ++operation.current;
    setPhase("processing");
    const result = await attachVideo({ access, materialId, providerVideoId });
    if (revision === operation.current) applyVideoResult(result);
  };

  const activeVideo = video ?? primaryVideo;
  return (
    <MaterialVideoAuthoringView
      access={access}
      activeVideo={activeVideo}
      deletionPendingSave={deleteVideoId !== null}
      deletionVideo={deletionVideo}
      disabled={disabled}
      onAttach={() => {
        void attach();
      }}
      onDeleteOwned={async () => {
        if (activeVideo === null) return;
        operation.current += 1;
        const transfer = await uploadTransfer.current;
        uploadTransfer.current = null;
        await transfer?.abort(true).catch(() => undefined);
        if (uploadAttempt.current?.videoId === activeVideo.videoId) {
          clearBrowserVideoUploadAttempt(uploadAttempt.current);
          uploadAttempt.current = null;
        }
        const retainedVideo =
          primaryVideo?.videoId === activeVideo.videoId ? null : primaryVideo;
        setDeletionVideo(activeVideo);
        setVideo(retainedVideo);
        setRecoveredVideoId(null);
        setPhase(phaseForVideo(retainedVideo));
        onChange(retainedVideo, activeVideo.videoId);
      }}
      onFileSelected={(file) => {
        const revision = operation.current + 1;
        void upload(file).catch(() => {
          if (revision === operation.current) setPhase("error");
        });
      }}
      onProviderVideoIdChange={setProviderVideoId}
      recovered={activeVideo !== null && activeVideo.videoId === recoveredVideoId}
      onReconcile={() => {
        if (activeVideo !== null) void reconcile(activeVideo.videoId);
      }}
      onRemove={() => {
        operation.current += 1;
        const transfer = uploadTransfer.current;
        uploadTransfer.current = null;
        void transfer
          ?.then((upload) => upload?.abort(false))
          .catch(() => undefined);
        if (uploadAttempt.current)
          clearBrowserVideoUploadAttempt(uploadAttempt.current);
        uploadAttempt.current = null;
        setVideo(null);
        setRecoveredVideoId(null);
        setPhase("idle");
        onChange(null, null);
      }}
      onRetryDeletion={() => {
        if (deletionVideo === null) return;
        void retryDeletion({ videoId: deletionVideo.videoId }).then(
          applyVideoResult,
        );
      }}
      phase={phase}
      progress={progress}
      providerVideoId={providerVideoId}
    />
  );
}

export interface MaterialVideoAuthoringViewProps {
  readonly access: "free" | "membership";
  readonly activeVideo: MaterialAuthoringVideo | null;
  readonly deletionPendingSave: boolean;
  readonly deletionVideo: MaterialAuthoringVideo | null;
  readonly disabled: boolean;
  readonly onAttach: () => void;
  readonly onDeleteOwned: () => void | Promise<void>;
  readonly onFileSelected: (file: File) => void;
  readonly onProviderVideoIdChange: (value: string) => void;
  readonly onReconcile: () => void;
  readonly onRemove: () => void;
  readonly onRetryDeletion: () => void;
  readonly phase: MaterialVideoAuthoringPhase;
  readonly progress: number;
  readonly providerVideoId: string;
  readonly recovered: boolean;
}

/** Production presentation boundary shared with Storybook state fixtures. */
export function MaterialVideoAuthoringView({
  access,
  activeVideo,
  deletionPendingSave,
  deletionVideo,
  disabled,
  onAttach,
  onDeleteOwned,
  onFileSelected,
  onProviderVideoIdChange,
  onReconcile,
  onRemove,
  onRetryDeletion,
  phase,
  progress,
  providerVideoId,
  recovered,
}: MaterialVideoAuthoringViewProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = disabled || phase === "uploading" || phase === "processing";
  const selectFile = (file: File | undefined) => {
    if (file && !busy && file.type.startsWith("video/")) onFileSelected(file);
  };

  return (
    <div
      className={`mt-4 grid gap-3 rounded-2xl border border-dashed p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${dragging ? "border-accent bg-accent/10" : "border-border bg-muted/30"}`}
      tabIndex={0}
      aria-label="Основное видео"
      onDragOver={(event) => {
        if (busy || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        if (busy) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        selectFile(event.dataTransfer.files[0]);
      }}
      onPaste={(event) => {
        if (busy || event.clipboardData.files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        selectFile(event.clipboardData.files[0]);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-accent">
            <Video aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {activeVideo?.title ?? "Основное видео не выбрано"}
            </p>
            <p
              aria-live="polite"
              className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground"
            >
              {phaseLabel(phase, progress)}
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
              selectFile(file);
            }}
            ref={fileInput}
            type="file"
          />
          <Button
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            size="sm"
            type="button"
            variant="outline"
          >
            <Upload aria-hidden="true" />
            Загрузить
          </Button>
          {activeVideo === null ||
          phase === "ready" ||
          phase === "interrupted_unusable" ? null : (
            <Button
              disabled={busy}
              onClick={onReconcile}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" />
              Проверить
            </Button>
          )}
          {activeVideo === null ? null : (
            <Button
              disabled={disabled}
              onClick={onRemove}
              size="sm"
              type="button"
              variant="ghost"
            >
              Убрать
            </Button>
          )}
          {activeVideo?.origin === "platform_upload" ? (
            <Button
              disabled={disabled}
              onClick={() => deleteDialog.current?.showModal()}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Trash2 aria-hidden="true" />
              Удалить…
            </Button>
          ) : null}
        </div>
      </div>
      <DeletionStatus
        pendingSave={deletionPendingSave}
        video={deletionVideo}
        onRetry={onRetryDeletion}
      />
      <InterruptedUploadStatus
        phase={phase}
        recovered={recovered}
        video={activeVideo}
      />
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Выбрать существующее видео Kinescope
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label
            className="grid gap-1.5 text-xs font-medium"
            htmlFor="provider-video-id"
          >
            ID видео · проект «
            {access === "membership" ? "Для участников" : "Публичный"}»
            <input
              className="h-10 min-w-0 rounded-xl border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={disabled}
              id="provider-video-id"
              onChange={(event) => {
                onProviderVideoIdChange(event.currentTarget.value);
              }}
              value={providerVideoId}
            />
          </label>
          <Button
            className="self-end"
            disabled={
              disabled ||
              providerVideoId.trim().length === 0 ||
              phase === "processing"
            }
            onClick={onAttach}
            type="button"
            variant="secondary"
          >
            {phase === "processing" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Link2 aria-hidden="true" />
            )}
            Привязать
          </Button>
        </div>
      </details>
      {activeVideo?.origin === "platform_upload" ? (
        <dialog
          aria-labelledby="video-delete-heading"
          className="m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-card backdrop:bg-foreground/45"
          ref={deleteDialog}
        >
          <div className="p-6 sm:p-8">
            <h2
              className="text-balance text-2xl font-semibold tracking-[-0.03em]"
              id="video-delete-heading"
            >
              Удалить «{activeVideo.title}» из Kinescope?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Видео будет убрано из материала и удалено из Kinescope. Это
              действие нельзя отменить.
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                onClick={() => deleteDialog.current?.close()}
                type="button"
                variant="outline"
              >
                Оставить видео
              </Button>
              <Button
                onClick={() => {
                  deleteDialog.current?.close();
                  void onDeleteOwned();
                }}
                type="button"
                variant="destructive"
              >
                Убрать и удалить из Kinescope
              </Button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}

function DeletionStatus({
  onRetry,
  pendingSave,
  video,
}: {
  readonly onRetry: () => void;
  readonly pendingSave: boolean;
  readonly video: MaterialAuthoringVideo | null;
}) {
  if (video === null) return null;
  const text = pendingSave
    ? `Удаление «${video.title}» сохраняется…`
    : video.state === "deletion_requested"
      ? `Удаление «${video.title}» запрошено.`
      : video.state === "deleting"
        ? `«${video.title}» удаляется из Kinescope.`
        : video.state === "deleted"
          ? `«${video.title}» удалено из Kinescope.`
          : video.state === "delete_failed"
            ? `Не удалось удалить «${video.title}». Повторите попытку.`
            : null;
  if (text === null) return null;
  return (
    <div
      className="rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6"
      role="status"
    >
      <p>{text}</p>
      {video.state === "delete_failed" && !pendingSave ? (
        <Button
          className="mt-3"
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" />
          Повторить удаление
        </Button>
      ) : null}
    </div>
  );
}

function InterruptedUploadStatus({
  phase,
  recovered,
  video,
}: {
  readonly phase: MaterialVideoAuthoringPhase;
  readonly recovered: boolean;
  readonly video: MaterialAuthoringVideo | null;
}) {
  if (!recovered || video === null) return null;
  const text = interruptedUploadText(phase, video);
  if (text === null) return null;
  return (
    <div
      className="rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6"
      role="status"
    >
      <p>{text}</p>
    </div>
  );
}

/** An adopted upload stays explained until the author resolves it, including while a check fails. */
function interruptedUploadText(
  phase: MaterialVideoAuthoringPhase,
  video: MaterialAuthoringVideo,
): string | null {
  const leftover = `Видео «${video.title}» осталось от незавершённой загрузки`;
  if (phase === "processing")
    return `${leftover} и пока не привязано к материалу. Проверяем его состояние в Kinescope.`;
  if (phase === "error")
    return `${leftover}. Проверить его состояние в Kinescope не удалось.`;
  if (phase !== "interrupted_unusable") return null;
  return video.state === "failed"
    ? `Kinescope не смог обработать файл «${video.title}». Загрузите видео заново или удалите незавершённую запись.`
    : `Kinescope получил файл «${video.title}» не полностью, поэтому видео не готово. Загрузите файл заново или удалите незавершённую запись.`;
}

function phaseLabel(
  phase: MaterialVideoAuthoringPhase,
  progress: number,
): string {
  if (phase === "uploading") return `Загрузка ${String(progress)}%`;
  if (phase === "processing") return "Kinescope обрабатывает видео";
  if (phase === "upload_not_authorized")
    return "Kinescope отклонил загрузку. Нужно исправить права доступа к сервису.";
  if (phase === "upload_outcome_unknown")
    return "Результат загрузки не подтверждён. Нужна проверка в Kinescope перед повтором.";
  if (phase === "interrupted_unusable") return "Загрузка не завершена";
  if (phase === "error") return "Нужна повторная попытка";
  if (phase === "ready") return "Видео готово";
  return "Перетащите видео или вставьте из буфера";
}

function isDeletionState(state: MaterialVideo["state"]): boolean {
  return (
    state === "deletion_requested" ||
    state === "deleting" ||
    state === "deleted" ||
    state === "delete_failed"
  );
}
