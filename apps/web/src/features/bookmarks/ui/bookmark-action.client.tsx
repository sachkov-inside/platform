"use client";

import { useId } from "react";
import { Bookmark, BookmarkCheck, LoaderCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { BookmarkActionProps } from "../model/bookmark-action-view";

/** Presentation only. The production adapter owns the saved state and commands. */
export function BookmarkAction({ view, onToggle }: BookmarkActionProps) {
  const descriptionId = useId();
  const bookmarked = "bookmarked" in view && view.bookmarked;
  const loading = view.kind === "loading";
  const pending = view.kind === "pending";
  const label = bookmarked ? "В закладках" : "В закладки";
  const message = view.kind === "error"
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
  const buttonClassName = "h-auto min-h-10 w-40 max-w-full shrink-0 justify-center whitespace-normal rounded-full py-2 aria-disabled:opacity-50";
  return (
    <div className="mt-6 flex flex-col items-end" data-bookmark-action-state={view.kind}>
      {view.kind === "anonymous" ? (
        <Button asChild className={buttonClassName} variant="outline">
          <a aria-describedby={descriptionId} href={view.loginHref} title={message}><Bookmark aria-hidden="true" />{label}</a>
        </Button>
      ) : (
        <Button
          aria-describedby={descriptionId}
          aria-disabled={loading || pending}
          aria-pressed={loading ? undefined : bookmarked}
          className={buttonClassName}
          onClick={() => { if (!loading && !pending) onToggle(view.kind === "error" ? view.desired : !bookmarked); }}
          title={message}
          type="button"
          variant={bookmarked ? "default" : "outline"}
        >
          {loading || pending ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : bookmarked ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
          {label}
        </Button>
      )}
      <p aria-live={view.kind === "error" ? "assertive" : "polite"} className={view.kind === "error" || view.kind === "denied" ? "mt-2 text-sm text-muted-foreground" : "sr-only"} id={descriptionId} role={view.kind === "error" ? "alert" : "status"}>{message}</p>
    </div>
  );
}
