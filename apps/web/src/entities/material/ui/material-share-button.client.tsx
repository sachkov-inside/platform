"use client";

import { Share2 } from "lucide-react";
import { useId, useState } from "react";

import { materialPath } from "@/shared/routing/public-page-path";
import { Button } from "@/shared/ui/button";

/**
 * Temporary semantic UI for #1553.
 * Replace through #1554 after Storybook acceptance.
 */
export interface MaterialShareButtonProps {
  readonly slug: string;
  readonly title: string;
}

/** Shares only the canonical material address, never the reader's private route context. */
export function MaterialShareButton({ slug, title }: MaterialShareButtonProps) {
  const fieldId = useId();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    readonly slug: string;
    readonly url: string;
    readonly copied: boolean;
  } | null>(null);
  const current = result?.slug === slug ? result : null;

  async function share() {
    if (pending) return;
    const url = new URL(materialPath(slug), window.location.origin).href;
    setPending(true);
    setResult(null);
    try {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title, url });
          return;
        } catch (error) {
          // Closing the system sheet is a completed user choice, not a copy request.
          if (error instanceof DOMException && error.name === "AbortError")
            return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        setResult({ slug, url, copied: true });
      } catch {
        setResult({ slug, url, copied: false });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative z-10 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 gap-1.5 text-muted-foreground"
        disabled={pending}
        aria-label={`Поделиться материалом «${title}»`}
        onClick={() => void share()}
      >
        <Share2 aria-hidden="true" className="size-4 shrink-0" />
        Поделиться
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {current === null
          ? null
          : current.copied
            ? "Ссылка скопирована"
            : "Не удалось скопировать автоматически"}
      </span>
      {current?.copied === false ? (
        <div className="basis-full min-w-0 text-xs text-muted-foreground">
          <label htmlFor={fieldId}>
            Не удалось скопировать автоматически. Скопируйте ссылку:
          </label>
          <input
            id={fieldId}
            className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            readOnly
            value={current.url}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            onClick={(event) => {
              event.currentTarget.select();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
