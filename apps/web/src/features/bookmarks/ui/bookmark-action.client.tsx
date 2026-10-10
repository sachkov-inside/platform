"use client";

import { useId } from "react";
import {
  Bookmark,
  BookmarkCheck,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { BookmarkActionProps } from "../model/bookmark-action-view";

/** Presentation only. The production adapter owns the saved state and commands. */
export function BookmarkAction({
  view,
  onToggle,
  compact = false,
}: BookmarkActionProps) {
  const descriptionId = useId();
  const bookmarked = "bookmarked" in view && view.bookmarked;
  const loading = view.kind === "loading";
  const pending = view.kind === "pending";
  const label = bookmarked ? "В закладках" : "В закладки";
  const message =
    view.kind === "load-error"
      ? "Не удалось загрузить закладку. Нажмите, чтобы повторить."
      : view.kind === "error"
        ? "Не сохранено. Нажмите ещё раз."
        : view.kind === "denied"
          ? "Чтобы сохранить закладку, нужен доступ к материалу."
          : loading
            ? "Загружаем закладку…"
            : pending
              ? "Сохраняем закладку…"
              : view.kind === "anonymous"
                ? "Войдите, чтобы сохранять закладки."
                : bookmarked
                  ? "Материал в закладках. Нажмите, чтобы убрать."
                  : "Нажмите, чтобы сохранить материал в закладки.";
  const buttonClassName = compact
    ? "size-11 shrink-0 rounded-lg p-0 aria-disabled:opacity-50"
    : "h-auto min-h-11 max-w-full shrink-0 justify-center whitespace-normal rounded-lg px-3 py-2 aria-disabled:opacity-50";
  return (
    <div
      className="flex flex-col items-end"
      data-bookmark-action-state={view.kind}
    >
      {view.kind === "anonymous" ? (
        <Button
          asChild
          className={buttonClassName}
          variant={compact ? "ghost" : "outline"}
        >
          <a
            aria-describedby={descriptionId}
            href={view.loginHref}
            title={message}
          >
            <Bookmark aria-hidden="true" />
            <span className={compact ? "sr-only" : undefined}>{label}</span>
          </a>
        </Button>
      ) : (
        <Button
          aria-describedby={descriptionId}
          aria-disabled={loading || pending}
          aria-pressed={
            loading || view.kind === "load-error" ? undefined : bookmarked
          }
          className={buttonClassName}
          onClick={() => {
            if (!loading && !pending)
              onToggle(view.kind === "error" ? view.desired : !bookmarked);
          }}
          title={message}
          type="button"
          variant={
            bookmarked
              ? compact
                ? "secondary"
                : "default"
              : compact
                ? "ghost"
                : "outline"
          }
        >
          {view.kind === "load-error" || (compact && view.kind === "error") ? (
            <CircleAlert
              aria-hidden="true"
              className="text-[var(--callout-bad)]"
            />
          ) : loading || pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : bookmarked ? (
            <BookmarkCheck aria-hidden="true" />
          ) : (
            <Bookmark aria-hidden="true" />
          )}
          <span className={compact ? "sr-only" : undefined}>{label}</span>
        </Button>
      )}
      <p
        aria-live={
          view.kind === "error" || view.kind === "load-error"
            ? "assertive"
            : "polite"
        }
        className={
          !compact &&
          (view.kind === "error" ||
            view.kind === "load-error" ||
            view.kind === "denied")
            ? "mt-2 text-sm text-muted-foreground"
            : "sr-only"
        }
        id={descriptionId}
        role={
          view.kind === "error" || view.kind === "load-error"
            ? "alert"
            : "status"
        }
      >
        {message}
      </p>
    </div>
  );
}
