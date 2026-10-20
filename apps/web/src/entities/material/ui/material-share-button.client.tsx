"use client";

import { Check, Upload } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";

import { cn } from "@/shared/lib/utils";
import { materialPath } from "@/shared/routing/public-page-path";
import { Button } from "@/shared/ui/button";

/**
 * Temporary semantic UI for #1553.
 * Replace through #1554 after Storybook acceptance.
 */
export interface MaterialShareButtonProps {
  readonly slug: string;
  readonly title: string;
  readonly presentation?: "default" | "reader";
}

/** Shares only the canonical material address, never the reader's private route context. */
export function MaterialShareButton({
  slug,
  title,
  presentation = "default",
}: MaterialShareButtonProps) {
  const fieldId = useId();
  // Server HTML must not accept a click before this component owns its handler.
  const ready = useSyncExternalStore(subscribeToNothing, always, never);
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
    <div
      className={cn(
        "z-10 flex min-w-0 flex-wrap items-center gap-y-1",
        presentation === "reader" ? "static shrink-0" : "relative",
        current?.copied === false && presentation !== "reader"
          ? "basis-full"
          : "shrink-0",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={
          presentation === "reader"
            ? "min-h-11 text-muted-foreground"
            : "size-11 text-muted-foreground"
        }
        disabled={!ready || pending}
        aria-label={`Поделиться материалом «${title}»`}
        title={current?.copied === true ? "Ссылка скопирована" : "Поделиться"}
        onClick={() => void share()}
      >
        {current?.copied === true ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Upload aria-hidden="true" className="size-4" />
        )}
        {presentation === "reader" ? (
          <span data-share-label>Поделиться</span>
        ) : null}
      </Button>
      <span
        aria-live="polite"
        className={
          presentation === "reader" && current?.copied === true
            ? "absolute inset-x-0 top-full mt-2 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-sm"
            : "sr-only"
        }
      >
        {current === null
          ? null
          : current.copied
            ? "Ссылка скопирована"
            : "Не удалось скопировать автоматически"}
      </span>
      {current?.copied === false ? (
        <div
          className={
            presentation === "reader"
              ? "absolute inset-x-0 top-full mt-2 min-w-0 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-sm"
              : "basis-full min-w-0 text-xs text-muted-foreground"
          }
        >
          <label htmlFor={fieldId}>Скопируйте ссылку:</label>
          <input
            id={fieldId}
            className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-2 text-base text-foreground sm:text-sm"
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

function subscribeToNothing(): () => void {
  return () => undefined;
}
function always(): boolean {
  return true;
}
function never(): boolean {
  return false;
}
