"use client";

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { FileText, ImagePlus, LoaderCircle, RotateCcw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { z } from "zod";

import { usePendingUploadGuard } from "@/shared/lib/autosave/use-autosave";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

type AssetKind = "file" | "image";
type UploadStatus = "hashing" | "uploading" | "processing" | "error";

interface UploadedAsset {
  readonly assetId: string;
  readonly contentType: string;
  readonly filename: string;
  readonly kind: AssetKind;
  readonly size: number;
  readonly state: "ready";
}

export interface PendingUpload {
  readonly file: File;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly insertAt: number;
  readonly kind: AssetKind;
  readonly message?: string;
  readonly progress: number;
  readonly retryWithNewIdempotencyKey: boolean;
  readonly status: UploadStatus;
}

export interface MaterialAssetUploadController {
  readonly enqueue: (
    files: readonly File[],
    forcedKind?: AssetKind,
    insertAt?: number,
  ) => void;
  readonly uploads: readonly PendingUpload[];
  readonly cancel: (id: string) => void;
  readonly retry: (id: string) => void;
}

const uploadResponseSchema = z.object({
  assetId: z.uuid(),
  contentType: z.string(),
  filename: z.string(),
  kind: z.enum(["file", "image"]),
  size: z.number().int().positive(),
  state: z.literal("ready"),
});
const uploadProblemSchema = z.object({ code: z.string() });

export function useMaterialAssetUploads(
  editor: Editor | null,
  materialId: string | null,
  onImageReady?: (assetId: string, file: File) => void,
): MaterialAssetUploadController {
  const [uploads, setUploads] = useState<readonly PendingUpload[]>([]);
  usePendingUploadGuard(uploads.length > 0);
  const positions = useRef(new Map<string, number>());
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const cancelled = useRef(new Set<string>());

  useEffect(
    () => () => {
      for (const request of requests.current.values()) request.abort();
      requests.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    const mapPositions = ({ transaction }: { transaction: Transaction }) => {
      for (const [id, position] of positions.current)
        positions.current.set(id, transaction.mapping.map(position));
    };
    editor.on("transaction", mapPositions);
    return () => {
      editor.off("transaction", mapPositions);
    };
  }, [editor]);
  useEffect(() => {
    if (uploads.length === 0) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
    };
  }, [uploads.length]);

  const begin = useCallback(
    async (upload: PendingUpload) => {
      if (materialId === null) return;
      cancelled.current.delete(upload.id);
      setUploads((current) =>
        patchUpload(current, upload.id, { status: "hashing", progress: 0 }),
      );
      try {
        const checksum = await sha256(upload.file);
        if (cancelled.current.has(upload.id)) return;
        const result = await uploadFile({
          checksum,
          file: upload.file,
          idempotencyKey: upload.idempotencyKey,
          kind: upload.kind,
          materialId,
          onProgress(progress) {
            setUploads((current) =>
              patchUpload(current, upload.id, {
                progress,
                status: "uploading",
              }),
            );
          },
          onRequest(request) {
            requests.current.set(upload.id, request);
          },
          onUploaded() {
            setUploads((current) =>
              patchUpload(current, upload.id, {
                progress: 100,
                status: "processing",
              }),
            );
          },
        });
        requests.current.delete(upload.id);
        if (
          cancelled.current.has(upload.id) ||
          editor === null ||
          editor.isDestroyed
        )
          return;
        if (upload.kind === "image")
          onImageReady?.(result.assetId, upload.file);
        const node =
          upload.kind === "image"
            ? {
                type: "assetImage",
                attrs: { assetId: result.assetId, alt: "", caption: null },
              }
            : {
                type: "assetFile",
                attrs: { assetId: result.assetId, label: result.filename },
              };
        const position = Math.min(
          positions.current.get(upload.id) ?? upload.insertAt,
          editor.state.doc.content.size,
        );
        editor
          .chain()
          .insertContentAt(position, [node, { type: "paragraph" }])
          .run();
        positions.current.delete(upload.id);
        setUploads((current) =>
          current.filter((candidate) => candidate.id !== upload.id),
        );
      } catch (error) {
        requests.current.delete(upload.id);
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        const errorCode = uploadErrorCode(error);
        setUploads((current) =>
          patchUpload(current, upload.id, {
            message: uploadErrorMessage(error),
            retryWithNewIdempotencyKey:
              errorCode !== "network" &&
              errorCode !== "dependency_unavailable" &&
              errorCode !== "upload_in_progress",
            status: "error",
          }),
        );
      }
    },
    [editor, materialId, onImageReady],
  );

  const enqueue = useCallback<MaterialAssetUploadController["enqueue"]>(
    (files, forcedKind, insertAt) => {
      if (editor === null || materialId === null) return;
      for (const file of files) {
        const kind =
          forcedKind ?? (file.type.startsWith("image/") ? "image" : "file");
        const upload: PendingUpload = {
          file,
          id: crypto.randomUUID(),
          idempotencyKey: `web-asset-${crypto.randomUUID()}`,
          insertAt: insertAt ?? editor.state.selection.from,
          kind,
          progress: 0,
          retryWithNewIdempotencyKey: false,
          status: "hashing",
        };
        positions.current.set(upload.id, upload.insertAt);
        setUploads((current) => [...current, upload]);
        void begin(upload);
      }
    },
    [begin, editor, materialId],
  );

  const cancel = useCallback((id: string) => {
    positions.current.delete(id);
    cancelled.current.add(id);
    requests.current.get(id)?.abort();
    requests.current.delete(id);
    setUploads((current) => current.filter((upload) => upload.id !== id));
  }, []);

  const retry = useCallback(
    (id: string) => {
      const upload = uploads.find((candidate) => candidate.id === id);
      if (upload === undefined) return;
      const { message: _message, ...retained } = upload;
      const retried: PendingUpload = {
        ...retained,
        id: crypto.randomUUID(),
        idempotencyKey: upload.retryWithNewIdempotencyKey
          ? `web-asset-${crypto.randomUUID()}`
          : upload.idempotencyKey,
        progress: 0,
        retryWithNewIdempotencyKey: false,
        status: "hashing",
      };
      positions.current.set(
        retried.id,
        positions.current.get(id) ?? upload.insertAt,
      );
      positions.current.delete(id);
      setUploads((current) =>
        current.map((candidate) => (candidate.id === id ? retried : candidate)),
      );
      void begin(retried);
    },
    [begin, uploads],
  );

  return { cancel, enqueue, retry, uploads };
}

export function MaterialAssetUploadButtons({
  controller,
  disabled,
  insertAt,
  onSelected,
  search = "",
}: {
  readonly controller: MaterialAssetUploadController;
  readonly disabled: boolean;
  readonly insertAt?: () => number;
  readonly onSelected?: () => void;
  readonly search?: string;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected =
    (kind: AssetKind) => (event: ChangeEvent<HTMLInputElement>) => {
      controller.enqueue(
        Array.from(event.currentTarget.files ?? []),
        kind,
        insertAt?.(),
      );
      onSelected?.();
      event.currentTarget.value = "";
    };
  return (
    <>
      <Button
        aria-label="Добавить изображение"
        className={cn(
          "w-full justify-start gap-3 px-3 text-sm",
          !"Фото и изображения"
            .toLocaleLowerCase("ru")
            .includes(search.toLocaleLowerCase("ru")) && "hidden",
        )}
        disabled={disabled}
        onClick={() => {
          imageInput.current?.click();
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ImagePlus aria-hidden="true" />
        Изображение
      </Button>
      <Button
        aria-label="Добавить файл"
        className={cn(
          "w-full justify-start gap-3 px-3 text-sm",
          !"Файл"
            .toLocaleLowerCase("ru")
            .includes(search.toLocaleLowerCase("ru")) && "hidden",
        )}
        disabled={disabled}
        onClick={() => {
          fileInput.current?.click();
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        <FileText aria-hidden="true" />
        Файл
      </Button>
      <input
        accept="image/avif,image/jpeg,image/png,image/webp"
        aria-label="Выбрать изображения"
        className="sr-only"
        disabled={disabled}
        multiple
        onChange={selected("image")}
        ref={imageInput}
        type="file"
      />
      <input
        aria-label="Выбрать файлы"
        className="sr-only"
        disabled={disabled}
        multiple
        onChange={selected("file")}
        ref={fileInput}
        type="file"
      />
    </>
  );
}

export function MaterialAssetUploadQueue({
  controller,
}: {
  readonly controller: MaterialAssetUploadController;
}) {
  if (controller.uploads.length === 0) return null;
  return (
    <section
      aria-label="Загрузки"
      aria-live="polite"
      className="border-b border-border bg-card p-3"
    >
      <ul className="grid gap-2" role="list">
        {controller.uploads.map((upload) => (
          <li className="rounded-lg bg-muted/65 p-3" key={upload.id}>
            <div className="flex min-w-0 items-center gap-3">
              {upload.status === "hashing" ||
              upload.status === "uploading" ||
              upload.status === "processing" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                />
              ) : upload.kind === "image" ? (
                <ImagePlus
                  aria-hidden="true"
                  className="size-4 shrink-0 text-accent"
                />
              ) : (
                <FileText
                  aria-hidden="true"
                  className="size-4 shrink-0 text-accent"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {upload.file.name}
                </p>
                <p
                  className={cn(
                    "text-xs text-muted-foreground",
                    upload.status === "error" && "text-destructive",
                  )}
                >
                  {upload.status === "hashing"
                    ? "Проверяем файл…"
                    : upload.status === "uploading"
                      ? `Загрузка · ${String(upload.progress)}%`
                      : upload.status === "processing"
                        ? "Проверяем и подготавливаем файл…"
                        : upload.message}
                </p>
              </div>
              {upload.status === "error" ? (
                <Button
                  aria-label="Повторить загрузку"
                  className="size-9"
                  onClick={() => {
                    controller.retry(upload.id);
                  }}
                  size="icon-lg"
                  type="button"
                  variant="ghost"
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                aria-label="Отменить загрузку"
                className="size-9"
                onClick={() => {
                  controller.cancel(upload.id);
                }}
                size="icon-lg"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {upload.status === "uploading" ? (
              <progress
                aria-label={`Загрузка ${upload.file.name}`}
                className="mt-2 h-1.5 w-full accent-accent"
                max={100}
                value={upload.progress}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function uploadFile(input: {
  readonly checksum: string;
  readonly file: File;
  readonly idempotencyKey: string;
  readonly kind: AssetKind;
  readonly materialId: string;
  readonly onProgress: (progress: number) => void;
  readonly onRequest: (request: XMLHttpRequest) => void;
  readonly onUploaded: () => void;
}): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    input.onRequest(request);
    request.open(
      "POST",
      `/api/authoring/materials/${encodeURIComponent(input.materialId)}/assets`,
    );
    request.responseType = "json";
    request.setRequestHeader("idempotency-key", input.idempotencyKey);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        input.onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.upload.addEventListener("load", () => {
      input.onUploaded();
    });
    request.addEventListener("abort", () => {
      reject(new DOMException("Upload aborted", "AbortError"));
    });
    request.addEventListener("error", () => {
      reject(new Error("network"));
    });
    request.addEventListener("load", () => {
      const parsed = uploadResponseSchema.safeParse(request.response);
      if (request.status === 201 && parsed.success) resolve(parsed.data);
      else {
        const problem = uploadProblemSchema.safeParse(request.response);
        reject(
          new Error(problem.success ? problem.data.code : "upload_failed"),
        );
      }
    });
    const form = new FormData();
    form.set("checksumSha256", input.checksum);
    form.set("declaredSize", String(input.file.size));
    form.set("kind", input.kind);
    form.set("file", input.file);
    request.send(form);
  });
}

function patchUpload(
  uploads: readonly PendingUpload[],
  id: string,
  values: Partial<PendingUpload>,
): readonly PendingUpload[] {
  return uploads.map((upload) =>
    upload.id === id ? { ...upload, ...values } : upload,
  );
}

function uploadErrorMessage(error: unknown): string {
  const code = uploadErrorCode(error);
  switch (code) {
    case "executable_content":
      return "Исполняемые файлы и скрипты запрещены";
    case "image_too_large":
      return "Изображение превышает допустимый размер";
    case "mime_mismatch":
    case "unsupported_image_type":
      return "Формат файла не совпадает с его содержимым";
    case "unsupported_file_type":
      return "Видео загружается через отдельный видеосценарий";
    case "checksum_mismatch":
      return "Файл повредился при передаче — повторите загрузку";
    default:
      return "Не удалось загрузить. Локальный текст сохранён";
  }
}

function uploadErrorCode(error: unknown): string {
  return error instanceof Error ? error.message : "upload_failed";
}
