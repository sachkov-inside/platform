"use client";

import type { Editor } from "@tiptap/core";
import {
  FileText,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { z } from "zod";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

type AssetKind = "file" | "image";
type UploadStatus = "hashing" | "uploading" | "processing" | "ready" | "error";

interface UploadedAsset {
  readonly assetId: string;
  readonly contentType: string;
  readonly filename: string;
  readonly kind: AssetKind;
  readonly size: number;
  readonly state: "ready";
}

export interface PendingUpload {
  readonly decorative: boolean;
  readonly file: File;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly insertAt: number;
  readonly kind: AssetKind;
  readonly message?: string;
  readonly progress: number;
  readonly retryWithNewIdempotencyKey: boolean;
  readonly result?: UploadedAsset;
  readonly status: UploadStatus;
  readonly text: string;
}

export interface MaterialAssetUploadController {
  readonly enqueue: (
    files: readonly File[],
    forcedKind?: AssetKind,
    insertAt?: number,
  ) => void;
  readonly uploads: readonly PendingUpload[];
  readonly cancel: (id: string) => void;
  readonly insert: (id: string) => void;
  readonly retry: (id: string) => void;
  readonly update: (id: string, values: Partial<Pick<PendingUpload, "decorative" | "text">>) => void;
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
): MaterialAssetUploadController {
  const [uploads, setUploads] = useState<readonly PendingUpload[]>([]);
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const cancelled = useRef(new Set<string>());

  useEffect(() => () => {
    for (const request of requests.current.values()) request.abort();
    requests.current.clear();
  }, []);

  const begin = useCallback(async (upload: PendingUpload) => {
    if (materialId === null) return;
    cancelled.current.delete(upload.id);
    setUploads((current) => patchUpload(current, upload.id, { status: "hashing", progress: 0 }));
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
          setUploads((current) => patchUpload(current, upload.id, { progress, status: "uploading" }));
        },
        onRequest(request) {
          requests.current.set(upload.id, request);
        },
        onUploaded() {
          setUploads((current) => patchUpload(current, upload.id, { progress: 100, status: "processing" }));
        },
      });
      requests.current.delete(upload.id);
      setUploads((current) => patchUpload(current, upload.id, {
        progress: 100,
        result,
        status: "ready",
        text: result.kind === "file" ? result.filename : "",
      }));
    } catch (error) {
      requests.current.delete(upload.id);
      if (error instanceof DOMException && error.name === "AbortError") return;
      setUploads((current) => patchUpload(current, upload.id, {
        message: uploadErrorMessage(error),
        retryWithNewIdempotencyKey: uploadErrorCode(error) !== "network",
        status: "error",
      }));
    }
  }, [materialId]);

  const enqueue = useCallback<MaterialAssetUploadController["enqueue"]>((files, forcedKind, insertAt) => {
    if (editor === null || materialId === null) return;
    for (const file of files) {
      const kind = forcedKind ?? (file.type.startsWith("image/") ? "image" : "file");
      const upload: PendingUpload = {
        decorative: false,
        file,
        id: crypto.randomUUID(),
        idempotencyKey: `web-asset-${crypto.randomUUID()}`,
        insertAt: insertAt ?? editor.state.selection.from,
        kind,
        progress: 0,
        retryWithNewIdempotencyKey: false,
        status: "hashing",
        text: kind === "file" ? file.name : "",
      };
      setUploads((current) => [...current, upload]);
      void begin(upload);
    }
  }, [begin, editor, materialId]);

  const cancel = useCallback((id: string) => {
    cancelled.current.add(id);
    requests.current.get(id)?.abort();
    requests.current.delete(id);
    setUploads((current) => current.filter((upload) => upload.id !== id));
  }, []);

  const retry = useCallback((id: string) => {
    const upload = uploads.find((candidate) => candidate.id === id);
    if (upload === undefined) return;
    const { message: _message, result: _result, ...retained } = upload;
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
    setUploads((current) => current.map((candidate) => candidate.id === id ? retried : candidate));
    void begin(retried);
  }, [begin, uploads]);

  const update = useCallback<MaterialAssetUploadController["update"]>((id, values) => {
    setUploads((current) => patchUpload(current, id, values));
  }, []);

  const insert = useCallback((id: string) => {
    if (editor === null) return;
    const upload = uploads.find((candidate) => candidate.id === id);
    if (upload?.result === undefined) return;
    const text = upload.text.trim();
    if (upload.kind === "file" && text.length === 0) return;
    if (upload.kind === "image" && !upload.decorative && text.length === 0) return;
    const position = Math.min(upload.insertAt, editor.state.doc.content.size);
    const node = upload.kind === "image"
      ? {
          type: "assetImage",
          attrs: {
            alt: upload.decorative ? "" : text,
            assetId: upload.result.assetId,
            caption: null,
          },
        }
      : {
          type: "assetFile",
          attrs: { assetId: upload.result.assetId, label: text },
        };
    editor.chain().focus().insertContentAt(position, node).run();
    setUploads((current) => current.filter((candidate) => candidate.id !== id));
  }, [editor, uploads]);

  return { cancel, enqueue, insert, retry, update, uploads };
}

export function MaterialAssetUploadButtons({
  controller,
  disabled,
}: {
  readonly controller: MaterialAssetUploadController;
  readonly disabled: boolean;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = (kind: AssetKind) => (event: ChangeEvent<HTMLInputElement>) => {
    controller.enqueue(Array.from(event.currentTarget.files ?? []), kind);
    event.currentTarget.value = "";
  };
  return (
    <>
      <span aria-hidden="true" className="mx-1 h-7 w-px self-center bg-border" />
      <Button aria-label="Добавить изображение" className="size-11 sm:size-9" disabled={disabled} onClick={() => { imageInput.current?.click(); }} size="icon-lg" type="button" variant="ghost">
        <ImagePlus aria-hidden="true" />
      </Button>
      <Button aria-label="Добавить файл" className="size-11 sm:size-9" disabled={disabled} onClick={() => { fileInput.current?.click(); }} size="icon-lg" type="button" variant="ghost">
        <FileText aria-hidden="true" />
      </Button>
      <input accept="image/avif,image/jpeg,image/png,image/webp" aria-label="Выбрать изображения" className="sr-only" disabled={disabled} multiple onChange={selected("image")} ref={imageInput} type="file" />
      <input aria-label="Выбрать файлы" className="sr-only" disabled={disabled} multiple onChange={selected("file")} ref={fileInput} type="file" />
    </>
  );
}

/**
 * Temporary semantic UI for #180.
 * Replace through #190 after Storybook acceptance.
 */
export function MaterialAssetUploadQueue({
  controller,
}: {
  readonly controller: MaterialAssetUploadController;
}) {
  if (controller.uploads.length === 0) return null;
  return (
    <section aria-label="Загрузки" aria-live="polite" className="border-b border-border bg-card p-3">
      <ul className="grid gap-2" role="list">
        {controller.uploads.map((upload) => (
          <li className="rounded-lg bg-muted/65 p-3" key={upload.id}>
            <div className="flex min-w-0 items-center gap-3">
              {upload.status === "hashing" || upload.status === "uploading" || upload.status === "processing" ? (
                <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
              ) : upload.kind === "image" ? (
                <ImagePlus aria-hidden="true" className="size-4 shrink-0 text-accent" />
              ) : (
                <FileText aria-hidden="true" className="size-4 shrink-0 text-accent" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{upload.file.name}</p>
                <p className={cn("text-xs text-muted-foreground", upload.status === "error" && "text-destructive")}>
                  {upload.status === "hashing" ? "Проверяем файл…" :
                    upload.status === "uploading" ? `Загрузка · ${String(upload.progress)}%` :
                      upload.status === "processing" ? "Проверяем и подготавливаем файл…" :
                      upload.status === "ready" ? "Готово к вставке" : upload.message}
                </p>
              </div>
              {upload.status === "error" ? (
                <Button aria-label="Повторить загрузку" className="size-9" onClick={() => { controller.retry(upload.id); }} size="icon-lg" type="button" variant="ghost"><RotateCcw aria-hidden="true" /></Button>
              ) : null}
              <Button aria-label="Отменить загрузку" className="size-9" onClick={() => { controller.cancel(upload.id); }} size="icon-lg" type="button" variant="ghost"><X aria-hidden="true" /></Button>
            </div>
            {upload.status === "uploading" ? (
              <progress aria-label={`Загрузка ${upload.file.name}`} className="mt-2 h-1.5 w-full accent-accent" max={100} value={upload.progress} />
            ) : null}
            {upload.status === "ready" ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="grid gap-1 text-xs font-medium">
                  {upload.kind === "image" ? "Описание изображения" : "Название ссылки"}
                  <input
                    className="min-h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                    disabled={upload.kind === "image" && upload.decorative}
                    onChange={(event) => { controller.update(upload.id, { text: event.currentTarget.value }); }}
                    value={upload.text}
                  />
                </label>
                <Button className="self-end" disabled={upload.kind === "image" ? !upload.decorative && upload.text.trim().length === 0 : upload.text.trim().length === 0} onClick={() => { controller.insert(upload.id); }} type="button">Вставить</Button>
                {upload.kind === "image" ? (
                  <label className="flex min-h-10 items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                    <input checked={upload.decorative} onChange={(event) => { controller.update(upload.id, { decorative: event.currentTarget.checked }); }} type="checkbox" />
                    Декоративное, текстовое описание не требуется
                  </label>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    request.open("POST", `/api/authoring/materials/${encodeURIComponent(input.materialId)}/assets`);
    request.responseType = "json";
    request.setRequestHeader("idempotency-key", input.idempotencyKey);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) input.onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.upload.addEventListener("load", () => { input.onUploaded(); });
    request.addEventListener("abort", () => { reject(new DOMException("Upload aborted", "AbortError")); });
    request.addEventListener("error", () => { reject(new Error("network")); });
    request.addEventListener("load", () => {
      const parsed = uploadResponseSchema.safeParse(request.response);
      if (request.status === 201 && parsed.success) resolve(parsed.data);
      else {
        const problem = uploadProblemSchema.safeParse(request.response);
        reject(new Error(problem.success ? problem.data.code : "upload_failed"));
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
  return uploads.map((upload) => upload.id === id ? { ...upload, ...values } : upload);
}

function uploadErrorMessage(error: unknown): string {
  const code = uploadErrorCode(error);
  switch (code) {
    case "executable_content": return "Исполняемые файлы и скрипты запрещены";
    case "image_too_large": return "Изображение превышает допустимый размер";
    case "mime_mismatch":
    case "unsupported_image_type": return "Формат файла не совпадает с его содержимым";
    case "checksum_mismatch": return "Файл повредился при передаче — повторите загрузку";
    default: return "Не удалось загрузить. Локальный текст сохранён";
  }
}

function uploadErrorCode(error: unknown): string {
  return error instanceof Error ? error.message : "upload_failed";
}
