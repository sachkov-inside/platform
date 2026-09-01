"use client";

import {
  ArrowLeft,
  Check,
  CircleAlert,
  CloudOff,
  Eye,
  LoaderCircle,
  RotateCcw,
  Save,
} from "lucide-react";
import { useEffect, useState } from "react";

import { MaterialPublicationActionButton } from "@/features/material-lifecycle";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import type {
  MaterialAuthoringActions,
  MaterialAuthoringPresentation,
  MaterialSaveState,
} from "../model/presentation";

interface MaterialAuthoringChromeProps {
  readonly actions: MaterialAuthoringActions;
  readonly presentation: MaterialAuthoringPresentation;
}

export function MaterialAuthoringHeader({
  actions,
  canSave,
  presentation,
}: MaterialAuthoringChromeProps & { readonly canSave: boolean }) {
  const previewDisabled =
    presentation.draft.contentVersion === null ||
    presentation.save.kind === "dirty" ||
    presentation.save.kind === "submitting" ||
    presentation.blocking.kind !== "none";
  const publicationOperation =
    presentation.draft.status === "published" ? "unpublish" : "publish";
  const publicationDisabled =
    presentation.draft.status === "new" ||
    presentation.draft.contentVersion === null ||
    presentation.save.kind === "submitting" ||
    presentation.blocking.kind !== "none" ||
    presentation.draft.readOnly;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card px-4 py-3 sm:px-6">
      <div className="mx-auto flex w-full max-w-[80rem] flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-label="Вернуться к материалам"
            className="size-11"
            onClick={actions.onBack}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{materialStateLabel(presentation.draft.status)}</span>
              <span aria-live="polite" className="lg:hidden">
                · {compactSaveStateLabel(presentation.save)}
              </span>
            </div>
            <h1
              className="truncate text-base font-semibold tracking-[-0.02em] sm:text-lg"
              id="material-editor-heading"
            >
              {presentation.draft.title.length > 0
                ? presentation.draft.title
                : "Новый материал"}
            </h1>
          </div>
        </div>
        <dl className="hidden items-center gap-5 border-l border-border pl-5 lg:flex">
          <div className="min-w-0">
            <dt className="font-mono text-xs text-muted-foreground">Состояние</dt>
            <dd className="mt-0.5 min-w-0 truncate text-xs font-semibold text-foreground">
              {saveStateLabel(presentation.save)}
            </dd>
          </div>
        </dl>
        <div className="grid w-full grid-cols-2 items-center gap-2 sm:ml-auto sm:flex sm:w-auto">
          <Button
            className="min-h-11 px-3"
            disabled={previewDisabled}
            onClick={actions.onOpenPreview}
            type="button"
            variant="outline"
          >
            <Eye aria-hidden="true" data-icon="inline-start" />
            Предпросмотр
          </Button>
          {presentation.draft.status === "new" ? null : (
            <MaterialPublicationActionButton
              className="min-h-11 px-3"
              disabled={publicationDisabled}
              form="material-authoring-form"
              name="publicationState"
              operation={publicationOperation}
              type="submit"
              value={publicationOperation === "publish" ? "published" : "unpublished"}
              variant="outline"
            />
          )}
          <Button
            className="col-span-2 min-h-11 px-3 sm:col-span-1"
            disabled={!canSave}
            form="material-authoring-form"
            type="submit"
          >
            {presentation.save.kind === "submitting" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                data-icon="inline-start"
              />
            ) : (
              <Save aria-hidden="true" data-icon="inline-start" />
            )}
            {saveButtonLabel(presentation)}
          </Button>
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
      <div className="border-b border-border bg-destructive/8 px-4 py-5 sm:px-6" role="alert">
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
      <div className="border-b border-border bg-destructive/8 px-4 py-5 sm:px-6" role="alert">
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
    <div className="border-b border-border bg-destructive/8 px-4 py-5 sm:px-6" role="alert">
      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-2xl gap-3">
          <CloudOff aria-hidden="true" className="mt-1 size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold">Не удалось сохранить материал</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Изменения остаются в редакторе. Проверьте соединение и повторите сохранение.
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
  const noticeKey = `${String(presentation.noticeRevision)}:${presentation.validation.kind}:${presentation.save.kind}:${String(presentation.draft.contentVersion)}`;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const inputInvalid =
    presentation.validation.kind === "invalid" &&
    presentation.validation.scope === "input";
  const saved =
    presentation.save.kind === "saved" && presentation.draft.contentVersion !== null;
  const visible =
    inputInvalid || saved || presentation.validation.kind === "checking";

  useEffect(() => {
    if (!visible) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDismissedKey(noticeKey);
    }, 3_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [noticeKey, visible]);

  if (
    dismissedKey === noticeKey ||
    !visible
  ) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-4 top-4 z-50 ml-auto max-w-xs rounded-xl px-4 py-3 shadow-card md:left-auto md:right-5 md:top-5",
        inputInvalid ? "bg-card text-foreground" : "bg-primary text-primary-foreground",
      )}
      role={inputInvalid ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        {presentation.validation.kind === "checking" ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-5 shrink-0 animate-spin motion-reduce:animate-none"
          />
        ) : inputInvalid ? (
          <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-destructive" />
        ) : (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
            <Check aria-hidden="true" className="size-3.5" />
          </span>
        )}
        <p className="min-w-0 text-sm font-semibold leading-5">
          {noticeLabel(presentation)}
        </p>
      </div>
    </div>
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
      <CircleAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-destructive" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function saveButtonLabel(presentation: MaterialAuthoringPresentation): string {
  if (presentation.save.kind === "submitting") {
    return presentation.draft.status === "new" ? "Создание…" : "Сохранение…";
  }
  return presentation.draft.status === "new" ? "Создать черновик" : "Сохранить";
}

function noticeLabel(presentation: MaterialAuthoringPresentation): string {
  if (presentation.validation.kind === "checking") {
    return presentation.draft.status === "new" ? "Создаём черновик" : "Сохраняем материал";
  }
  if (
    presentation.validation.kind === "invalid" &&
    presentation.validation.scope === "input"
  ) {
    return "Проверьте поля";
  }
  return presentation.draft.status === "new" ? "Черновик создан" : "Материал сохранён";
}

function saveStateLabel(state: MaterialSaveState): string {
  switch (state.kind) {
    case "clean":
      return "Без изменений";
    case "dirty":
      return "Есть несохранённые изменения";
    case "submitting":
      return "Сохранение…";
    case "saved":
      return `Сохранено ${state.savedAtLabel}`;
  }
}

function compactSaveStateLabel(state: MaterialSaveState): string {
  switch (state.kind) {
    case "clean":
      return "Без изменений";
    case "dirty":
      return "Не сохранено";
    case "submitting":
      return "Сохранение…";
    case "saved":
      return `Сохранено ${state.savedAtLabel}`;
  }
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
