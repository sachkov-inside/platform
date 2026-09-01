"use client";

import { Link2, LoaderCircle, RefreshCw, Upload, Video } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { Button } from "@/shared/ui/button";

const videoSchema = z.object({
  access: z.enum(["free", "membership"]),
  failureCode: z.string().optional(),
  materialId: z.uuid(),
  state: z.enum(["uploading", "processing", "ready", "failed"]),
  title: z.string(),
  videoId: z.uuid(),
}).strict();
const bffSchema = z.object({ kind: z.literal("ready"), value: z.unknown() }).strict();
const uploadResponseSchema = z.object({ uploadEndpoint: z.url(), video: videoSchema }).strict();

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
  const fileInput = useRef<HTMLInputElement>(null);
  const [providerVideoId, setProviderVideoId] = useState("");
  const [video, setVideo] = useState<z.infer<typeof videoSchema> | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "error">("idle");
  const [progress, setProgress] = useState(0);

  if (materialId === null) {
    return (
      <p className="mt-3 rounded-xl bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
        Сначала сохраните новый Material, затем добавьте основное видео.
      </p>
    );
  }

  const reconcile = async (videoId: string) => {
    setPhase("processing");
    const formData = new FormData();
    formData.set("operation", "reconcile");
    formData.set("videoId", videoId);
    const response = await requestSameOriginMutation(
      "/api/authoring/material-videos",
      "POST",
      formData,
    );
    const parsed = response.ok ? parseVideoBff(response.body) : null;
    if (parsed === null) {
      setPhase("error");
      return;
    }
    setVideo(parsed);
    if (parsed.state === "ready") {
      onChange(parsed.videoId);
      setPhase("idle");
    } else {
      setPhase(parsed.state === "failed" ? "error" : "processing");
    }
  };

  const upload = async (file: File) => {
    setPhase("uploading");
    setProgress(0);
    const formData = new FormData();
    formData.set("access", access);
    formData.set("byteSize", String(file.size));
    formData.set("filename", file.name);
    formData.set("materialId", materialId);
    formData.set("operation", "upload");
    formData.set("submissionId", crypto.randomUUID());
    formData.set("title", file.name.replace(/\.[^.]+$/u, ""));
    const initialized = await requestSameOriginMutation(
      "/api/authoring/material-videos",
      "POST",
      formData,
    );
    const envelope = initialized.ok ? bffSchema.safeParse(initialized.body) : null;
    const parsed = envelope?.success ? uploadResponseSchema.safeParse(envelope.data.value) : null;
    if (parsed === null || !parsed.success) {
      setPhase("error");
      return;
    }
    setVideo(parsed.data.video);
    if (new URL(parsed.data.uploadEndpoint).hostname.endsWith(".invalid")) {
      setProgress(100);
      await reconcile(parsed.data.video.videoId);
      return;
    }
    const tus = await import("tus-js-client");
    const transfer = new tus.Upload(file, {
      chunkSize: 8 * 1024 * 1024,
      onError: () => { setPhase("error"); },
      onProgress: (sent, total) => { setProgress(Math.round((sent / total) * 100)); },
      onSuccess: () => { void reconcile(parsed.data.video.videoId); },
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1_000, 3_000, 5_000],
      storeFingerprintForResuming: true,
      uploadUrl: parsed.data.uploadEndpoint,
    });
    const previous = await transfer.findPreviousUploads();
    if (previous[0] !== undefined) transfer.resumeFromPreviousUpload(previous[0]);
    transfer.start();
  };

  const attach = async () => {
    const formData = new FormData();
    formData.set("access", access);
    formData.set("materialId", materialId);
    formData.set("operation", "attach");
    formData.set("providerVideoId", providerVideoId);
    setPhase("processing");
    const response = await requestSameOriginMutation(
      "/api/authoring/material-videos",
      "POST",
      formData,
    );
    const parsed = response.ok ? parseVideoBff(response.body) : null;
    if (parsed === null) {
      setPhase("error");
      return;
    }
    setVideo(parsed);
    if (parsed.state === "ready") {
      onChange(parsed.videoId);
      setPhase("idle");
    } else {
      setPhase(parsed.state === "failed" ? "error" : "processing");
    }
  };

  const activeVideoId = video?.videoId ?? primaryVideoId;
  return (
    <div className="mt-4 grid gap-4 rounded-2xl bg-muted/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-accent"><Video aria-hidden="true" className="size-5" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{video?.title ?? (activeVideoId === null ? "Основное видео не выбрано" : "Основное видео привязано")}</p>
            <p aria-live="polite" className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">
              {phase === "uploading" ? `Загрузка ${String(progress)}%` : phase === "processing" ? "Kinescope обрабатывает видео" : phase === "error" ? "Нужна повторная попытка" : activeVideoId === null ? "Видео хранится отдельно от body Material" : "Готово к Save"}
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
              if (file !== undefined) void upload(file);
            }}
            ref={fileInput}
            type="file"
          />
          <Button disabled={disabled || phase === "uploading"} onClick={() => fileInput.current?.click()} size="sm" type="button" variant="outline">
            <Upload aria-hidden="true" />Загрузить
          </Button>
          {activeVideoId === null ? null : (
            <Button disabled={disabled || phase === "uploading"} onClick={() => void reconcile(activeVideoId)} size="sm" type="button" variant="outline">
              <RefreshCw aria-hidden="true" />Проверить
            </Button>
          )}
          {activeVideoId === null ? null : (
            <Button disabled={disabled} onClick={() => { setVideo(null); onChange(null); }} size="sm" type="button" variant="ghost">Убрать</Button>
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
            onChange={(event) => { setProviderVideoId(event.currentTarget.value); }}
            value={providerVideoId}
          />
        </label>
        <Button className="self-end" disabled={disabled || providerVideoId.trim().length === 0 || phase === "processing"} onClick={() => void attach()} type="button" variant="secondary">
          {phase === "processing" ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Link2 aria-hidden="true" />}
          Привязать
        </Button>
      </div>
    </div>
  );
}

function parseVideoBff(input: unknown): z.infer<typeof videoSchema> | null {
  const envelope = bffSchema.safeParse(input);
  if (!envelope.success) return null;
  const parsed = videoSchema.safeParse(envelope.data.value);
  return parsed.success ? parsed.data : null;
}
