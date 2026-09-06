"use client";

import { useId } from "react";
import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import { materialReadingLabels } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import type { ReadingActionProps } from "../model/reading-progress-view";

/** Presentation only. The production adapter owns access, commands and saved state. */
export function ReadingAction({ format, view, onSetReadingState, onRefresh }: ReadingActionProps) {
  const descriptionId = useId();
  const label = materialReadingLabels(format).complete;
  const buttonClassName = "h-auto min-h-10 w-40 max-w-full shrink-0 justify-center whitespace-normal rounded-full py-2 aria-disabled:opacity-50";
  const isRead = "isRead" in view && view.isRead;
  const loading = view.kind === "loading";
  const pending = view.kind === "pending";
  const unavailable = "canMark" in view && !view.canMark && !isRead;
  const message = view.kind === "error"
    ? "Не сохранено. Нажмите ещё раз."
    : view.kind === "conflict"
      ? "Отметка обновлена в другом окне."
      : loading ? "Загружаем отметку…"
        : pending ? "Сохраняем отметку…"
          : unavailable ? "Чтобы отметить материал, нужен доступ к нему."
            : view.kind === "anonymous" ? "Войдите, чтобы сохранить отметку."
              : isRead ? "Отметка сохранена. Нажмите, чтобы снять её." : "Нажмите, чтобы отметить материал.";
  return (
    <div className="mt-6 flex flex-col items-end" data-reading-action-state={view.kind}>
      {view.kind === "anonymous" ? (
        <Button asChild className={buttonClassName} variant="outline">
          <a aria-describedby={descriptionId} href={view.loginHref} title={message}><Circle aria-hidden="true" />{label}</a>
        </Button>
      ) : (
        <Button
          aria-describedby={descriptionId}
          aria-disabled={loading || pending || unavailable}
          aria-pressed={loading ? undefined : isRead}
          className={buttonClassName}
          onClick={() => { if (!loading && !pending && !unavailable) onSetReadingState(view.kind === "error" ? view.desiredIsRead : !isRead); }}
          title={message}
          type="button"
          variant={isRead ? "default" : "outline"}
        >
          {loading || pending ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : isRead ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
          {label}
        </Button>
      )}
      <p aria-live={view.kind === "error" ? "assertive" : "polite"} className={view.kind === "error" || view.kind === "conflict" ? "mt-2 text-sm text-muted-foreground" : "sr-only"} id={descriptionId} role={view.kind === "error" ? "alert" : "status"}>{message}</p>
      {view.kind === "conflict" ? <Button className="min-h-10 px-0" onClick={onRefresh} variant="link">Обновить статус</Button> : null}
    </div>
  );
}
