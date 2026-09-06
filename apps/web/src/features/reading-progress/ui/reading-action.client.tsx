"use client";

import { useId } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { MaterialReadingStatus, materialReadingLabels } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import type { ReadingActionProps } from "../model/reading-progress-view";

/** Presentation only. The production adapter owns access, commands and saved state. */
export function ReadingAction({ format, view, onSetReadingState, onRefresh }: ReadingActionProps) {
  const descriptionId = useId();
  const labels = materialReadingLabels(format);
  const className = "mt-8 min-h-[12rem] rounded-2xl border border-border bg-card px-5 py-4 sm:min-h-[8rem]";
  if (view.kind === "anonymous") return (
    <section aria-label="Отметка материала" className={className}>
      <p className="text-sm text-muted-foreground">Войдите, чтобы сохранить отметку об изучении.</p>
      <Button asChild className="mt-3 min-h-11 px-4" variant="outline"><a href={view.loginHref}>Войти и сохранить прогресс</a></Button>
    </section>
  );
  if (view.kind === "loading") return (
    <section aria-label="Отметка материала" aria-busy="true" className={className}>
      <p role="status" className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />Загружаем вашу отметку…</p>
    </section>
  );
  const pending = view.kind === "pending";
  const unavailable = !view.canMark && !view.isRead;
  const message = view.kind === "error"
    ? "Не удалось сохранить. Ваша отметка не изменилась."
    : view.kind === "conflict"
      ? "Отметка изменилась в другом окне. Показано актуальное состояние."
      : pending
        ? "Сохраняем отметку…"
        : unavailable
          ? "Чтобы отметить материал, нужен доступ к нему."
          : view.isRead
            ? "Отметка сохранена. Её можно снять в любой момент."
            : "Отметьте материал, когда закончите изучение.";
  return (
    <section aria-label="Отметка материала" className={className} data-reading-action-state={view.kind}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <div className="min-h-5 min-w-0">
          {view.isRead ? <MaterialReadingStatus format={format} isRead /> : <p className="text-sm font-semibold">Ваш прогресс</p>}
        </div>
        <Button
          aria-describedby={descriptionId}
          aria-disabled={pending || unavailable}
          className="min-h-11 w-full whitespace-normal px-4 text-left aria-disabled:opacity-50 sm:w-[17rem]"
          onClick={() => { if (!pending && !unavailable) onSetReadingState(view.kind === "error" ? view.desiredIsRead : !view.isRead); }}
          variant={view.isRead ? "outline" : "default"}
        >
          <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : view.isRead ? null : <Check aria-hidden="true" className="size-4" />}</span>
          {view.kind === "error" ? "Повторить сохранение" : view.isRead ? "Снять отметку" : labels.action}
        </Button>
      </div>
      <p aria-live={view.kind === "error" ? "assertive" : "polite"} className="mt-3 min-h-10 text-sm leading-5 text-muted-foreground sm:min-h-5" id={descriptionId} role={view.kind === "error" ? "alert" : "status"}>{message}</p>
      {view.kind === "conflict" ? <Button className="mt-2 min-h-11 px-0" onClick={onRefresh} variant="link">Обновить статус</Button> : null}
    </section>
  );
}
