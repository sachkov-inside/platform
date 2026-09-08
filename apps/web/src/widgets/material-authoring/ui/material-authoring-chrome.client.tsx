"use client";
import { materialSaveStateLabel } from "../model/material-save-state-label";

import { ArrowLeft, CircleAlert, CloudOff, Eye, RotateCcw } from "lucide-react";

import { MaterialPublicationActionButton } from "@/features/material-lifecycle";
import { Button } from "@/shared/ui/button";

import type {
  MaterialAuthoringActions,
  MaterialAuthoringPresentation,
} from "../model/presentation";

interface MaterialAuthoringChromeProps {
  readonly actions: MaterialAuthoringActions;
  readonly presentation: MaterialAuthoringPresentation;
}

export function MaterialAuthoringHeader({
  actions,
  presentation,
}: MaterialAuthoringChromeProps & { readonly canSave: boolean }) {
  const disabled =
    presentation.blocking.kind !== "none" || presentation.draft.readOnly;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-[80rem] flex-wrap items-center justify-between gap-3">
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
          <Button
            aria-label="Вернуться к материалам"
            onClick={actions.onBack}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <h1
              className="max-w-[36ch] truncate text-sm font-semibold"
              id="material-editor-heading"
            >
              {presentation.draft.title || "Новый материал"}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground" role="status">
              <span>{materialStateLabel(presentation.draft.status)}</span> ·{" "}
              {materialSaveStateLabel(presentation.save)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="Предпросмотр"
            disabled={
              presentation.blocking.kind !== "none" ||
              presentation.draft.materialId === null
            }
            onClick={actions.onOpenPreview}
            type="button"
            variant="ghost"
          >
            <Eye />
            <span className="hidden sm:inline">Предпросмотр</span>
          </Button>
          {presentation.draft.status === "published" ? (
            <MaterialPublicationActionButton
              disabled={disabled || presentation.save.kind === "submitting"}
              operation="unpublish"
              onClick={() => {
                actions.onSave("unpublished");
              }}
              type="button"
              variant="outline"
            />
          ) : (
            <MaterialPublicationActionButton
              disabled={
                disabled ||
                presentation.draft.materialId === null ||
                presentation.save.kind === "submitting"
              }
              operation="publish"
              onClick={() => {
                actions.onSave("published");
              }}
              type="button"
            />
          )}
        </div>
      </div>
    </header>
  );
}

export function MaterialAuthoringBlockingState({
  actions,
  presentation,
}: MaterialAuthoringChromeProps) {
  if (presentation.blocking.kind === "none") {
    return null;
  }
  if (presentation.blocking.kind === "conflict") {
    return (
      <div
        className="border-b border-border bg-destructive/8 px-4 py-5 sm:px-6"
        role="alert"
      >
        <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <BlockingMessage
            description="Сравните изменения или откройте сохранённый материал в новой вкладке для ручного переноса. Ваш локальный ввод останется здесь."
            title="Материал изменился в другой сессии"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                actions.onConflictAction("compare");
              }}
              type="button"
            >
              Сравнить
            </Button>
            <Button
              onClick={() => {
                actions.onConflictAction("open_current");
              }}
              type="button"
              variant="outline"
            >
              Открыть текущую
            </Button>
            <Button
              onClick={() => {
                actions.onConflictAction("copy");
              }}
              type="button"
              variant="ghost"
            >
              Скопировать мои изменения
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (presentation.blocking.kind === "not_found") {
    return (
      <div
        className="border-b border-border bg-destructive/8 px-4 py-5 sm:px-6"
        role="alert"
      >
        <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <BlockingMessage
            description="Он мог быть удалён в другой сессии. Ложное сохранение не показано."
            title="Материал больше не найден"
          />
          <Button onClick={actions.onBack} type="button">
            Вернуться к материалам
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div
      className="border-b border-border bg-destructive/8 px-4 py-5 sm:px-6"
      role="alert"
    >
      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-2xl gap-3">
          <CloudOff
            aria-hidden="true"
            className="mt-1 size-5 shrink-0 text-destructive"
          />
          <div>
            <p className="font-semibold">Не удалось сохранить материал</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Изменения остаются в редакторе. Проверьте соединение и повторите
              сохранение.
            </p>
            <p className="mt-2 font-mono text-[0.6875rem] text-muted-foreground">
              Код обращения: {presentation.blocking.correlationId}
            </p>
          </div>
        </div>
        <Button onClick={actions.onRetry} type="button">
          <RotateCcw aria-hidden="true" data-icon="inline-start" />
          Повторить
        </Button>
      </div>
    </div>
  );
}

export function MaterialAuthoringNotice({
  presentation,
}: {
  readonly presentation: MaterialAuthoringPresentation;
}) {
  if (presentation.validation.kind !== "invalid") return null;
  return (
    <p className="px-6 py-3 text-sm text-destructive" role="alert">
      {presentation.validation.scope === "publication"
        ? "Не удалось опубликовать. Проверьте отмеченные поля."
        : "Изменения ещё не сохранены. Проверьте отмеченные поля."}
    </p>
  );
}

function BlockingMessage({
  description,
  title,
}: {
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className="flex max-w-2xl gap-3">
      <CircleAlert
        aria-hidden="true"
        className="mt-1 size-5 shrink-0 text-destructive"
      />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function materialStateLabel(
  state: MaterialAuthoringPresentation["draft"]["status"],
): string {
  switch (state) {
    case "new":
      return "Новый материал";
    case "draft":
      return "Черновик";
    case "published":
      return "Опубликован";
    case "unpublished":
      return "Снят с публикации";
  }
}
