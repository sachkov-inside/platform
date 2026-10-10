"use client";

import { useId } from "react";
import { CheckCircle2, Circle, CircleAlert, LoaderCircle } from "lucide-react";
import { materialReadingLabels } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import type { ReadingActionProps } from "../model/reading-progress-view";

/** Presentation only. The production adapter owns access, commands and saved state. */
export function ReadingAction({
  compact = false,
  format,
  view,
  onSetReadingState,
  onRefresh,
}: ReadingActionProps) {
  const descriptionId = useId();
  const label = materialReadingLabels(format).complete;
  const buttonClassName = compact
    ? "h-11 shrink-0 rounded-lg px-3 aria-disabled:opacity-50"
    : "h-auto min-h-11 max-w-full shrink-0 justify-center whitespace-normal rounded-lg px-3 py-2 aria-disabled:opacity-50";
  const isRead = "isRead" in view && view.isRead;
  const loading = view.kind === "loading";
  const pending = view.kind === "pending";
  const unavailable = "canMark" in view && !view.canMark && !isRead;
  const message =
    view.kind === "load-error"
      ? "Не удалось загрузить отметку. Нажмите, чтобы повторить."
      : view.kind === "error"
        ? "Не сохранено. Нажмите ещё раз."
        : view.kind === "conflict"
          ? "Отметка обновлена в другом окне."
          : loading
            ? "Загружаем отметку…"
            : pending
              ? "Сохраняем отметку…"
              : unavailable
                ? "Чтобы отметить материал, нужен доступ к нему."
                : view.kind === "anonymous"
                  ? "Войдите, чтобы сохранить отметку."
                  : isRead
                    ? "Отметка сохранена. Нажмите, чтобы снять её."
                    : "Нажмите, чтобы отметить материал.";
  return (
    <div
      className="flex flex-col items-end"
      data-reading-action-state={view.kind}
    >
      {view.kind === "anonymous" ? (
        <Button asChild className={buttonClassName} variant="outline">
          <a
            aria-describedby={descriptionId}
            href={view.loginHref}
            title={message}
          >
            <Circle aria-hidden="true" />
            <span>{label}</span>
          </a>
        </Button>
      ) : (
        <Button
          aria-describedby={descriptionId}
          aria-disabled={loading || pending || unavailable}
          aria-pressed={
            loading || view.kind === "load-error" ? undefined : isRead
          }
          className={buttonClassName}
          onClick={() => {
            if (view.kind === "load-error") onRefresh();
            else if (!loading && !pending && !unavailable)
              onSetReadingState(
                view.kind === "error" ? view.desiredIsRead : !isRead,
              );
          }}
          title={message}
          type="button"
          variant={isRead ? (compact ? "secondary" : "default") : "outline"}
        >
          {view.kind === "load-error" ? (
            <CircleAlert
              aria-hidden="true"
              className="text-[var(--callout-bad)]"
            />
          ) : loading || pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : isRead ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <Circle aria-hidden="true" />
          )}
          <span>{label}</span>
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
            view.kind === "conflict")
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
      {view.kind === "conflict" ? (
        <Button className="min-h-11 px-0" onClick={onRefresh} variant="link">
          Обновить статус
        </Button>
      ) : null}
    </div>
  );
}
