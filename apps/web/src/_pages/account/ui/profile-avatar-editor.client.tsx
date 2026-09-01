"use client";

import {
  Camera,
  ImagePlus,
  LoaderCircle,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import {
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  ProfileAvatar,
  type PrivateMemberProfile,
} from "@/entities/member-profile";
import { MAX_PROFILE_AVATAR_FILE_BYTES } from "@/shared/api/mutation-limits";
import { Button } from "@/shared/ui/button";

import {
  AvatarMutationError,
  mutateProfileAvatar,
  type ProfileAvatarCrop,
  type ProfileAvatarMutation,
  type ProfileAvatarMutationInput,
} from "../api/profile-avatar-mutation.browser";

export type { ProfileAvatarMutation } from "../api/profile-avatar-mutation.browser";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Crop = ProfileAvatarCrop;

interface SelectedImage {
  readonly file: File;
  readonly height: number;
  readonly url: string;
  readonly width: number;
}

type AvatarStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "hashing" }
  | { readonly kind: "uploading"; readonly progress: number }
  | { readonly kind: "processing" }
  | { readonly kind: "removing" }
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

type UploadStatus = Extract<
  AvatarStatus,
  { readonly kind: "hashing" | "processing" | "uploading" }
>;

interface AvatarMutationVariables {
  readonly input: ProfileAvatarMutationInput;
  readonly onProgress: (progress: number) => void;
}

export function ProfileAvatarEditor({
  mutation = mutateProfileAvatar,
  onProfileChange,
  profile,
}: {
  readonly mutation?: ProfileAvatarMutation;
  readonly onProfileChange: (profile: PrivateMemberProfile) => void;
  readonly profile: PrivateMemberProfile;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [crop, setCrop] = useState<Crop>({ centerX: 0.5, centerY: 0.5, zoom: 1 });
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    kind: "hashing",
  });
  const [clientError, setClientError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const avatarMutation = useMutation<
    PrivateMemberProfile,
    unknown,
    AvatarMutationVariables
  >({
    mutationFn: ({ input, onProgress }) => mutation(input, onProgress),
    onSuccess: (updated, variables) => {
      if (variables.input.kind === "upload") {
        setImage(null);
        dialogRef.current?.close();
      }
      onProfileChange(updated);
    },
  });

  useEffect(
    () => () => {
      if (image !== null) URL.revokeObjectURL(image.url);
    },
    [image],
  );

  const chooseFile = (file: File | undefined) => {
    if (file === undefined || avatarMutation.isPending) return;
    if (
      !ACCEPTED_TYPES.has(file.type) ||
      file.size === 0 ||
      file.size > MAX_PROFILE_AVATAR_FILE_BYTES
    ) {
      avatarMutation.reset();
      setClientError("Выберите JPEG, PNG или WebP размером до 10 МБ.");
      return;
    }
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      setImage((previous) => {
        if (previous !== null) URL.revokeObjectURL(previous.url);
        return {
          file,
          height: probe.naturalHeight,
          url,
          width: probe.naturalWidth,
        };
      });
      setCrop({ centerX: 0.5, centerY: 0.5, zoom: 1 });
      avatarMutation.reset();
      setClientError(null);
      dialogRef.current?.showModal();
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      avatarMutation.reset();
      setClientError("Изображение не удалось прочитать.");
    };
    probe.src = url;
  };

  const upload = () => {
    if (image === null) return;
    setClientError(null);
    setUploadStatus({ kind: "hashing" });
    avatarMutation.mutate({
      input: { crop, file: image.file, kind: "upload", profile },
      onProgress: (progress) => {
        setUploadStatus(
          progress >= 1
            ? { kind: "processing" }
            : { kind: "uploading", progress },
        );
      },
    });
  };

  const remove = () => {
    setClientError(null);
    avatarMutation.mutate({
      input: { kind: "remove", profile },
      onProgress: () => undefined,
    });
  };

  const bounds = image === null ? null : cropCenterBounds(image, crop.zoom);
  const busy = avatarMutation.isPending;
  let status: AvatarStatus = { kind: "idle" };
  if (clientError !== null) {
    status = { kind: "error", message: clientError };
  } else if (avatarMutation.isPending) {
    status =
      avatarMutation.variables.input.kind === "remove"
        ? { kind: "removing" }
        : uploadStatus;
  } else if (avatarMutation.isError) {
    status = {
      kind: "error",
      message: avatarErrorMessage(avatarMutation.error),
    };
  } else if (avatarMutation.isSuccess) {
    status = {
      kind: "success",
      message:
        avatarMutation.variables.input.kind === "remove"
          ? "Аватар удалён."
          : "Аватар сохранён.",
    };
  }

  return (
    <section
      aria-labelledby="profile-avatar-heading"
      className="border-b border-border pb-7"
      onDragEnter={(event) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setDragging(false);
        chooseFile(event.dataTransfer.files[0]);
      }}
      onPaste={(event: ClipboardEvent<HTMLElement>) => {
        chooseFile(
          [...event.clipboardData.items]
            .find((item) => item.kind === "file" && item.type.startsWith("image/"))
            ?.getAsFile() ?? undefined,
        );
      }}
    >
      <div className="flex items-center gap-4">
        <ProfileAvatar
          avatar={profile.avatar}
          displayName={profile.displayName}
          publicProfileId={profile.publicProfileId}
          size="small"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" id="profile-avatar-heading">
            Аватар
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            JPEG, PNG или WebP до 10 МБ. Можно перетащить или вставить из буфера.
          </p>
        </div>
      </div>
      <div
        className={`mt-4 flex flex-wrap gap-2 rounded-xl transition-colors ${dragging ? "bg-accent/12 outline-2 outline-accent outline-offset-2" : ""}`}
      >
        <Button
          className="min-h-11 px-4"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          type="button"
          variant="outline"
        >
          <Camera aria-hidden="true" />
          {profile.avatar === null ? "Добавить фото" : "Заменить фото"}
        </Button>
        {profile.avatar === null ? null : (
          <Button
            className="min-h-11 px-4"
            disabled={busy}
            onClick={remove}
            type="button"
            variant="ghost"
          >
            {status.kind === "removing" ? (
              <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            {status.kind === "removing" ? "Удаляем…" : "Удалить"}
          </Button>
        )}
      </div>
      <input
        accept="image/jpeg,image/png,image/webp"
        aria-label="Выбрать изображение для аватара"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          chooseFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />
      <AvatarStatusNotice status={status} />

      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className="m-auto w-[min(42rem,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-background p-0 text-foreground shadow-2xl backdrop:bg-foreground/35"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        ref={dialogRef}
      >
        <div className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-[-0.035em]" id={titleId}>
                Кадрировать аватар
              </h2>
              <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted-foreground" id={descriptionId}>
                Перетащите фото или настройте положение и масштаб стрелками клавиатуры.
              </p>
            </div>
            <Button
              aria-label="Закрыть кадрирование"
              className="size-11 shrink-0"
              disabled={busy}
              onClick={() => dialogRef.current?.close()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </div>

          {image === null ? (
            <div className="mt-6 grid min-h-72 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <ImagePlus aria-hidden="true" className="size-10" />
            </div>
          ) : (
            <>
              <div className="mt-6 grid place-items-center rounded-2xl bg-muted p-4 sm:p-8">
                <div
                  aria-label="Область кадрирования. Перетаскивайте изображение указателем."
                  className="relative aspect-square w-full max-w-72 touch-none overflow-hidden rounded-full bg-background shadow-lg outline outline-1 outline-foreground/15"
                  onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
                    pointerRef.current = { x: event.clientX, y: event.clientY };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
                    const previous = pointerRef.current;
                    if (previous === null || bounds === null) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const minSide = Math.min(image.width, image.height);
                    const renderedWidth = rect.width * crop.zoom * image.width / minSide;
                    const renderedHeight = rect.height * crop.zoom * image.height / minSide;
                    setCrop((current) => ({
                      ...current,
                      centerX: clamp(current.centerX - (event.clientX - previous.x) / renderedWidth, bounds.minX, bounds.maxX),
                      centerY: clamp(current.centerY - (event.clientY - previous.y) / renderedHeight, bounds.minY, bounds.maxY),
                    }));
                    pointerRef.current = { x: event.clientX, y: event.clientY };
                  }}
                  onPointerUp={() => {
                    pointerRef.current = null;
                  }}
                  role="group"
                >
                  {/* eslint-disable-next-line next/no-img-element -- a local blob crop preview cannot pass through the Next optimizer */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="pointer-events-none absolute max-w-none select-none"
                    draggable={false}
                    src={image.url}
                    style={cropImageStyle(image, crop)}
                  />
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3 sm:gap-5">
                <CropRange
                  label="По горизонтали"
                  max={bounds?.maxX ?? 1}
                  min={bounds?.minX ?? 0}
                  onChange={(centerX) => {
                    setCrop((current) => ({ ...current, centerX }));
                  }}
                  value={crop.centerX}
                />
                <CropRange
                  label="По вертикали"
                  max={bounds?.maxY ?? 1}
                  min={bounds?.minY ?? 0}
                  onChange={(centerY) => {
                    setCrop((current) => ({ ...current, centerY }));
                  }}
                  value={crop.centerY}
                />
                <CropRange
                  icon={<ZoomIn aria-hidden="true" className="size-4" />}
                  label="Масштаб"
                  max={4}
                  min={1}
                  onChange={(zoom) => {
                    const nextBounds = cropCenterBounds(image, zoom);
                    setCrop((current) => ({
                      centerX: clamp(current.centerX, nextBounds.minX, nextBounds.maxX),
                      centerY: clamp(current.centerY, nextBounds.minY, nextBounds.maxY),
                      zoom,
                    }));
                  }}
                  step={0.05}
                  value={crop.zoom}
                />
              </div>
            </>
          )}

          <AvatarStatusNotice status={status} />
          <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-7 sm:flex sm:justify-end">
            <Button
              className="min-h-12 px-5"
              disabled={busy}
              onClick={() => dialogRef.current?.close()}
              type="button"
              variant="ghost"
            >
              Отмена
            </Button>
            <Button
              className="min-h-12 px-5"
              disabled={image === null || busy}
              onClick={upload}
              type="button"
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Upload aria-hidden="true" />
              )}
              {status.kind === "processing" ? "Обрабатываем…" : "Сохранить аватар"}
            </Button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

function CropRange({
  icon,
  label,
  max,
  min,
  onChange,
  step = 0.001,
  value,
}: {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly value: number;
}) {
  return (
    <label className="text-xs font-semibold">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <input
        className="mt-2 min-h-11 w-full accent-accent sm:mt-3"
        max={max}
        min={min}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value));
        }}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function AvatarStatusNotice({ status }: { readonly status: AvatarStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "success" || status.kind === "removing") {
    return (
      <p className="mt-4 text-sm font-semibold" role="status">
        {status.kind === "removing" ? "Удаляем аватар…" : status.message}
      </p>
    );
  }
  if (status.kind === "error") {
    return (
      <p className="mt-4 rounded-xl bg-destructive/8 p-3 text-sm font-medium text-destructive" role="alert">
        {status.message}
      </p>
    );
  }
  const label =
    status.kind === "hashing"
      ? "Проверяем файл…"
      : status.kind === "processing"
        ? "Файл загружен. Сервер создаёт безопасные размеры…"
        : `Загружаем… ${String(Math.round(status.progress * 100))}%`;
  return (
    <div className="mt-4" role="status">
      <p className="text-sm font-medium">{label}</p>
      {status.kind === "uploading" ? (
        <progress
          aria-label="Загрузка аватара"
          className="mt-2 h-2 w-full accent-accent"
          max={1}
          value={status.progress}
        >
          {String(Math.round(status.progress * 100))}%
        </progress>
      ) : null}
    </div>
  );
}

function cropCenterBounds(image: SelectedImage, zoom: number) {
  const side = Math.min(image.width, image.height) / zoom;
  const halfX = side / (2 * image.width);
  const halfY = side / (2 * image.height);
  return { maxX: 1 - halfX, maxY: 1 - halfY, minX: halfX, minY: halfY };
}

function cropImageStyle(image: SelectedImage, crop: Crop): CSSProperties {
  const minSide = Math.min(image.width, image.height);
  const width = crop.zoom * image.width / minSide * 100;
  const height = crop.zoom * image.height / minSide * 100;
  return {
    height: `${String(height)}%`,
    left: `${String(50 - crop.centerX * width)}%`,
    top: `${String(50 - crop.centerY * height)}%`,
    width: `${String(width)}%`,
  };
}

function avatarErrorMessage(error: unknown): string {
  if (error instanceof AvatarMutationError) {
    if (error.code === "conflict") return "Профиль изменился в другой вкладке. Обновите страницу и повторите.";
    if (error.reason === "crop_out_of_bounds") return "Кадр вышел за границы изображения. Поправьте положение и повторите.";
    if (error.reason === "image_too_large") return "Изображение слишком большое. Выберите файл до 10 МБ.";
    if (error.code === "invalid_avatar") return "Сервер не принял изображение. Выберите другой JPEG, PNG или WebP.";
  }
  return "Не удалось изменить аватар. Проверьте соединение и повторите.";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
