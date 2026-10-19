"use client";

import { useId, useState } from "react";

import {
  coverLinkPreviewImage,
  type ContentCover,
} from "@/entities/material.model";
import { SocialCardArtwork } from "@/shared/link-preview";
import { presentText } from "@/shared/lib/text";
import { Button } from "@/shared/ui/button";

/**
 * Temporary semantic UI for #1546.
 * Replace through #1547 after Storybook acceptance.
 */
export interface MaterialLinkPreviewProps {
  readonly title: string;
  readonly description: string;
  readonly cover: ContentCover | null;
  readonly published: boolean;
  readonly getPublicUrl?: (() => Promise<string | null>) | undefined;
}

export function MaterialLinkPreview({
  title,
  description,
  cover,
  published,
  getPublicUrl,
}: MaterialLinkPreviewProps) {
  const headingId = useId();
  const [pending, setPending] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const image =
    cover == null || cover.renditions.length === 0
      ? null
      : coverLinkPreviewImage(cover, title, "");

  async function copyLink() {
    if (getPublicUrl === undefined || pending) return;
    setPending(true);
    setMessage("");
    setUrl(null);
    try {
      const next = await getPublicUrl();
      if (next === null) {
        setMessage("Материал ещё не опубликован. Опубликуйте его и повторите.");
        return;
      }
      setUrl(next);
      try {
        await navigator.clipboard.writeText(next);
        setMessage("Ссылка скопирована.");
      } catch {
        setMessage(
          "Не удалось скопировать автоматически. Выделите и скопируйте адрес ниже.",
        );
      }
    } catch {
      setMessage("Не удалось получить ссылку. Повторите попытку.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 border-b border-border py-7"
    >
      <h2 className="text-sm font-semibold" id={headingId}>
        Как выглядит ссылка
      </h2>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Предпросмотр текущего названия, описания и обложки. Изменения появятся в
        ссылке после сохранения и публикации. Telegram может менять оформление и
        сохранять прежнее превью.
      </p>
      <div className="mt-4 max-w-md overflow-hidden rounded-xl border border-border">
        {image === null ? (
          <div
            className="aspect-[1200/630] [container-type:inline-size]"
            role="img"
            aria-label={`Автоматическая картинка: ${presentText(title.trim()) ?? "Название материала"}`}
          >
            <SocialCardArtwork
              content={{
                eyebrow: "Материал",
                title: presentText(title.trim()) ?? "Название материала",
              }}
              responsive
            />
          </div>
        ) : (
          // A direct rendition matches og:image; Next Image would introduce a different crop/URL.
          // oxlint-disable-next-line next/no-img-element -- Show the exact og:image rendition.
          <img
            alt={presentText(title.trim()) ?? "Обложка материала"}
            className="h-auto w-full"
            src={image.url}
            width={image.width}
            height={image.height}
          />
        )}
        <div className="space-y-2 p-4">
          <p className="text-xs text-muted-foreground">Sachkov Inside</p>
          <p className="break-words text-base font-semibold">
            {presentText(title.trim()) ?? "Название материала"}
          </p>
          <p className="break-words text-sm text-muted-foreground">
            {presentText(description.trim()) ??
              "Добавьте краткое описание в параметрах материала."}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {published ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending || getPublicUrl === undefined}
            aria-busy={pending}
            onClick={() => {
              void copyLink();
            }}
          >
            {pending ? "Получаем ссылку…" : "Скопировать ссылку"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ссылка для отправки станет доступна после публикации.
          </p>
        )}
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
        {published && url !== null ? (
          <label className="block max-w-xl text-sm">
            Адрес материала
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base"
              readOnly
              value={url}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}
