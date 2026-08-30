"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  ArrowLeft,
  Bold,
  BookOpen,
  Check,
  CircleAlert,
  CloudOff,
  Eye,
  Heading2,
  Italic,
  List,
  ListOrdered,
  LoaderCircle,
  RotateCcw,
  Save,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import { materialTaxonomyLabel } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

import type {
  MaterialAuthoringActions,
  MaterialAuthoringPresentation,
  MaterialSaveState,
} from "../model/presentation";
import { MaterialCurrentPreview } from "./material-current-preview";
import { MaterialDeleteDialog } from "./material-delete-dialog.client";
import { MaterialPublicationActionButton } from "./material-publication-action-button";
import { MaterialAuthoringShell } from "./material-authoring-shell";
import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "./material-authoring-route-states";

interface MaterialAuthoringWorkspaceProps {
  readonly actions: MaterialAuthoringActions;
  readonly presentation: MaterialAuthoringPresentation;
}

/**
 * Production-owned Editor/exact Preview composition. Data is supplied through a
 * serializable presentation contract; transport, authorization and persistence stay in adapters.
 */
export function MaterialAuthoringWorkspace({
  actions,
  presentation,
}: MaterialAuthoringWorkspaceProps) {
  if (presentation.authorization.kind === "unauthorized") {
    return (
      <MaterialAuthoringUnauthorizedState
        action={<MaterialAuthoringSignInActions onBack={actions.onBack} />}
        context="editor"
      />
    );
  }

  if (presentation.mode === "preview" && presentation.preview !== null) {
    return (
      <MaterialCurrentPreview
        editorHref={
          presentation.draft.materialId === null
            ? "/authoring/materials/new"
            : `/authoring/materials/${presentation.draft.materialId}`
        }
        preview={presentation.preview}
      />
    );
  }

  return (
    <MaterialAuthoringShell current="create">
      <main
        aria-labelledby="material-editor-heading"
        className="@container/material-authoring h-full min-h-svh overflow-x-hidden bg-background text-foreground md:min-h-0 md:overflow-y-auto md:overscroll-y-contain"
        data-material-authoring
        id="authoring-content"
        tabIndex={-1}
      >
        <EditorHeader actions={actions} presentation={presentation} />
        <BlockingState actions={actions} presentation={presentation} />
        <AuthoringNotice presentation={presentation} />

        <form
          className="mx-auto grid w-full max-w-[52rem] min-w-0 gap-0 px-4 pb-14 pt-7 sm:px-6 @min-[68rem]/material-authoring:max-w-[80rem] @min-[68rem]/material-authoring:grid-cols-[minmax(18rem,0.72fr)_minmax(32rem,1.55fr)] @min-[68rem]/material-authoring:px-8 @min-[68rem]/material-authoring:pt-9"
          id="material-authoring-form"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const submitter =
              event.nativeEvent instanceof SubmitEvent
                ? event.nativeEvent.submitter
                : null;
            if (
              submitter instanceof HTMLButtonElement &&
              submitter.name === "publicationState"
            ) {
              formData.set("publicationState", submitter.value);
            }
            actions.onSave(formData);
          }}
        >
          <input name="document" type="hidden" value={JSON.stringify(presentation.draft.document)} />
          <input name="expectedContentVersion" type="hidden" value={presentation.draft.contentVersion ?? ""} />
          <input name="materialId" type="hidden" value={presentation.draft.materialId ?? ""} />
          <input name="publicationState" type="hidden" value={presentation.draft.status === "new" ? "draft" : presentation.draft.status} />
          <input name="seriesIds" type="hidden" value={JSON.stringify(presentation.draft.seriesIds)} />
          <input name="submissionId" type="hidden" value={presentation.submissionId} />
          <MetadataPanel actions={actions} presentation={presentation} />
          <DocumentPanel actions={actions} presentation={presentation} />
        </form>
      </main>
    </MaterialAuthoringShell>
  );
}

function EditorHeader({
  actions,
  presentation,
}: MaterialAuthoringWorkspaceProps) {
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
          <Button aria-label="Вернуться к материалам" className="size-11" onClick={actions.onBack} size="icon-lg" type="button" variant="ghost">
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{materialStateLabel(presentation.draft.status)}</span>
              <span aria-live="polite" className="lg:hidden">
                · {compactSaveStateLabel(presentation.save)}
              </span>
            </div>
            <h1 className="truncate text-base font-semibold tracking-[-0.02em] sm:text-lg" id="material-editor-heading">
              {presentation.draft.title.length > 0 ? presentation.draft.title : "Новый материал"}
            </h1>
          </div>
        </div>
        <dl className="hidden items-center gap-5 border-l border-border pl-5 lg:flex">
          <HeaderFact label="Состояние" value={saveStateLabel(presentation.save)} />
        </dl>
        <div className="grid w-full grid-cols-2 items-center gap-2 sm:ml-auto sm:flex sm:w-auto">
          <Button className="min-h-11 px-3" disabled={previewDisabled} onClick={actions.onOpenPreview} type="button" variant="outline">
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
              value={
                publicationOperation === "publish" ? "published" : "unpublished"
              }
              variant="outline"
            />
          )}
          <Button className="col-span-2 min-h-11 px-3 sm:col-span-1" disabled={presentation.save.kind !== "dirty" || presentation.blocking.kind !== "none" || presentation.draft.readOnly} form="material-authoring-form" type="submit">
            {presentation.save.kind === "submitting" ? (
              <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" data-icon="inline-start" />
            ) : (
              <Save aria-hidden="true" data-icon="inline-start" />
            )}
            {presentation.save.kind === "submitting"
              ? presentation.draft.status === "new"
                ? "Создание…"
                : "Сохранение…"
              : presentation.draft.status === "new"
                ? "Создать черновик"
                : "Сохранить"}
          </Button>
        </div>
      </div>
    </header>
  );
}

function HeaderFact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 truncate text-xs font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function MetadataPanel({
  actions,
  presentation,
}: MaterialAuthoringWorkspaceProps) {
  const disabled = presentation.save.kind === "submitting" || presentation.blocking.kind !== "none" || presentation.draft.readOnly;

  return (
    <section aria-labelledby="material-parameters-heading" className="min-w-0 border-b border-border pb-7 @min-[68rem]/material-authoring:border-b-0 @min-[68rem]/material-authoring:border-r @min-[68rem]/material-authoring:pb-0 @min-[68rem]/material-authoring:pr-7">
      <h2 className="text-sm font-semibold" id="material-parameters-heading">Параметры материала</h2>
      <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2 @min-[68rem]/material-authoring:grid-cols-1">
        <Field label="Название" targetId="material-title">
          <input
            aria-describedby={hasIssue(presentation, "/title") ? "material-guidance-heading" : undefined}
            aria-invalid={hasIssue(presentation, "/title") || undefined}
            autoComplete="off"
            className={fieldClassName}
            disabled={disabled}
            id="material-title"
            maxLength={160}
            name="title"
            onChange={(event) => {
              actions.onFieldChange("title", event.currentTarget.value);
            }}
            value={presentation.draft.title}
          />
        </Field>
        <Field label="Краткое описание" targetId="material-summary">
          <textarea
            aria-describedby={hasIssue(presentation, "/summary") ? "material-guidance-heading" : undefined}
            aria-invalid={hasIssue(presentation, "/summary") || undefined}
            autoComplete="off"
            className={cn(fieldClassName, "min-h-28 resize-y py-3 leading-6")}
            disabled={disabled}
            id="material-summary"
            maxLength={500}
            name="summary"
            onChange={(event) => {
              actions.onFieldChange("summary", event.currentTarget.value);
            }}
            value={presentation.draft.summary}
          />
        </Field>
        <Field label="Тема" targetId="material-topic">
          <Select
            disabled={disabled}
            name="topicId"
            onValueChange={(value) => {
              actions.onFieldChange("topicId", value);
            }}
            value={presentation.draft.topicId}
          >
            <SelectTrigger className={authoringSelectTriggerClassName} id="material-topic">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem className={authoringSelectItemClassName} value="unassigned">Не назначена</SelectItem>
              {presentation.availableTopics.map((topic) => (
                <SelectItem className={authoringSelectItemClassName} key={topic.value} value={topic.value}>{materialTaxonomyLabel(topic.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Формат" targetId="material-format">
          <Select
            disabled={disabled}
            name="formatId"
            onValueChange={(value) => {
              actions.onFieldChange("formatId", value);
            }}
            value={presentation.draft.formatId}
          >
            <SelectTrigger className={authoringSelectTriggerClassName} id="material-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem className={authoringSelectItemClassName} value="unassigned">Не назначен</SelectItem>
              {presentation.availableFormats.map((format) => (
                <SelectItem className={authoringSelectItemClassName} key={format.value} value={format.value}>{materialTaxonomyLabel(format.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <TagSelector actions={actions} disabled={disabled} presentation={presentation} />
        <SeriesSelector actions={actions} disabled={disabled} presentation={presentation} />
        <Field label="Доступ" targetId="material-access">
          <Select
            disabled={disabled}
            name="access"
            onValueChange={(value) => {
              actions.onFieldChange("access", value);
            }}
            value={presentation.draft.access}
          >
            <SelectTrigger className={authoringSelectTriggerClassName} id="material-access">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem className={authoringSelectItemClassName} value="free">Бесплатный</SelectItem>
              <SelectItem className={authoringSelectItemClassName} value="membership">Для участников</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <FormGuidance presentation={presentation} />
      {presentation.draft.canDelete &&
      presentation.draft.materialId !== null &&
      presentation.draft.contentVersion !== null ? (
        <section
          aria-labelledby="material-delete-heading"
          className="mt-7 border-t border-border pt-6"
        >
          <h2 className="text-sm font-semibold" id="material-delete-heading">
            Удаление черновика
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Доступно только пока Material ни разу не публиковался.
          </p>
          <div className="mt-4">
            <MaterialDeleteDialog
              contentVersion={presentation.draft.contentVersion}
              materialId={presentation.draft.materialId}
              onDelete={actions.onDelete}
              pending={presentation.deletion.pending}
              state={presentation.deletion.state}
              submissionId={presentation.submissionId}
              title={presentation.draft.title || null}
            />
          </div>
        </section>
      ) : null}
    </section>
  );
}

function FormGuidance({
  presentation,
}: {
  readonly presentation: MaterialAuthoringPresentation;
}) {
  if (presentation.validation.kind !== "invalid") {
    return null;
  }

  return (
    <section
      aria-labelledby="material-guidance-heading"
      aria-live="polite"
      className="mt-6 border-t border-border pt-5"
    >
      <h2 className="text-sm font-semibold" id="material-guidance-heading">
        {presentation.validation.scope === "input"
          ? "Проверьте перед сохранением"
          : "Перед публикацией"}
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm leading-6 text-muted-foreground">
        {presentation.validation.issues.map((issue) => (
          <li className="flex gap-2" key={`${issue.path}:${issue.message}`}>
            <span aria-hidden="true" className="text-accent">•</span>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeriesSelector({
  actions,
  disabled,
  presentation,
}: MaterialAuthoringWorkspaceProps & { readonly disabled: boolean }) {
  if (presentation.availableSeries.length === 0) {
    return null;
  }
  return (
    <fieldset className="min-w-0 sm:col-span-2 @min-[68rem]/material-authoring:col-span-1">
      <legend className="text-sm font-medium">Плейлисты</legend>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Новый материал добавится в конец выбранного плейлиста.
      </p>
      <div className="mt-2 grid gap-2">
        {presentation.availableSeries.map((series) => {
          const checked = presentation.draft.seriesIds.includes(series.value);
          return (
              <label
                className={cn(
                  "relative flex min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm font-medium transition-colors motion-reduce:transition-none",
                  "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
                  checked
                    ? "border-accent/45 bg-accent/10 text-foreground"
                    : "border-border bg-card text-foreground hover:bg-secondary",
                  disabled && "cursor-not-allowed opacity-60",
                )}
                key={series.value}
              >
                <input
                  checked={checked}
                  className="sr-only"
                  disabled={disabled}
                  onChange={(event) => {
                    actions.onSeriesToggle(series.value, event.currentTarget.checked);
                  }}
                  type="checkbox"
                />
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", checked ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground")}>
                  <BookOpen aria-hidden="true" className="size-4" />
                </span>
                <span className="truncate">{series.label}</span>
                <span className={cn("ml-auto grid size-6 shrink-0 place-items-center rounded-full border", checked ? "border-accent bg-accent text-accent-foreground" : "border-border text-transparent")}>
                  <Check aria-hidden="true" className="size-3.5" />
                </span>
              </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function TagSelector({
  actions,
  disabled,
  presentation,
}: MaterialAuthoringWorkspaceProps & { readonly disabled: boolean }) {
  return (
    <div className="min-w-0 sm:col-span-2 @min-[68rem]/material-authoring:col-span-1">
      <p className="mb-2 text-sm font-medium" id="material-tags-label">
        Теги
      </p>
      <div
        aria-labelledby="material-tags-label"
        className="flex min-h-12 flex-wrap gap-2 rounded-xl bg-card p-2"
        role="group"
      >
        {presentation.availableTags.length === 0 ? (
          <span className="px-1 py-1.5 text-sm text-muted-foreground">Нет доступных тегов</span>
        ) : (
          presentation.availableTags.map((tag) => {
            const checked = presentation.draft.tagIds.includes(tag.value);
            return (
              <label
                className={cn(
                  "relative flex min-h-9 cursor-pointer items-center rounded-lg px-3 text-sm font-medium transition-colors motion-reduce:transition-none",
                  "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
                  checked
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-muted",
                  disabled && "cursor-not-allowed opacity-60",
                )}
                key={tag.value}
              >
                <input
                  checked={checked}
                  className="sr-only"
                  disabled={disabled}
                  name="tagIds"
                  onChange={(event) => {
                    actions.onTagToggle(tag.value, event.currentTarget.checked);
                  }}
                  type="checkbox"
                  value={tag.value}
                />
                {tag.label}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function Field({
  children,
  hint,
  label,
  targetId,
}: {
  readonly children: ReactNode;
  readonly hint?: string;
  readonly label: string;
  readonly targetId: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium" htmlFor={targetId}>{label}</label>
        {hint === undefined ? null : <span className="font-mono text-[0.6875rem] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const fieldClassName =
  "min-h-12 w-full rounded-xl border border-input bg-card px-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:min-h-11 sm:text-sm";

const authoringSelectTriggerClassName = "min-h-12 text-base sm:min-h-11 sm:text-sm";
const authoringSelectItemClassName = "min-h-11 sm:min-h-10";

function DocumentPanel({ actions, presentation }: MaterialAuthoringWorkspaceProps) {
  return (
    <section aria-labelledby="document-heading" className="min-w-0 py-8 @min-[68rem]/material-authoring:px-8 @min-[68rem]/material-authoring:py-0">
      <h2 className="text-sm font-semibold" id="document-heading">Содержимое материала</h2>
      <MaterialDocumentEditor
        disabled={presentation.save.kind === "submitting" || presentation.blocking.kind !== "none" || presentation.draft.readOnly}
        document={presentation.draft.document}
        onChange={actions.onDocumentChange}
      />
    </section>
  );
}

function MaterialDocumentEditor({
  disabled,
  document,
  onChange,
}: {
  readonly disabled: boolean;
  readonly document: MaterialAuthoringPresentation["draft"]["document"];
  readonly onChange: MaterialAuthoringActions["onDocumentChange"];
}) {
  const editor = useEditor({
    content: document,
    editable: !disabled,
    extensions: [StarterKit],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-labelledby": "document-heading",
        "aria-multiline": "true",
        id: "material-body",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getJSON());
    },
  });

  useEffect(() => {
    if (editor !== null && editor.isEditable !== !disabled) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  if (editor === null) {
    return <div className="mt-5 min-h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" role="status">Подготовка редактора…</div>;
  }

  return (
    <div className="mt-5 overflow-clip rounded-xl border border-border bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
      <div aria-label="Форматирование" className="flex flex-wrap gap-1 border-b border-border bg-muted/65 p-2" role="toolbar">
        <ToolbarButton active={editor.isActive("bold")} disabled={disabled} label="Полужирный" onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} disabled={disabled} label="Курсив" onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("heading", { level: 2 })} disabled={disabled} label="Заголовок второго уровня" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("bulletList")} disabled={disabled} label="Маркированный список" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} disabled={disabled} label="Нумерованный список" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered aria-hidden="true" />
        </ToolbarButton>
      </div>
      <EditorContent
        className="[&_.ProseMirror]:min-h-[30rem] [&_.ProseMirror]:px-5 [&_.ProseMirror]:py-6 [&_.ProseMirror]:text-[1rem] [&_.ProseMirror]:leading-[1.75] [&_.ProseMirror]:outline-none [&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-8 [&_.ProseMirror_h2]:text-2xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:tracking-[-0.025em] [&_.ProseMirror_li]:my-1 [&_.ProseMirror_ol]:ml-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_p]:my-4 [&_.ProseMirror_ul]:ml-6 [&_.ProseMirror_ul]:list-disc sm:[&_.ProseMirror]:px-8 sm:[&_.ProseMirror]:py-8"
        editor={editor}
      />
    </div>
  );
}

function ToolbarButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <Button aria-label={label} aria-pressed={active} className="size-11 sm:size-9" disabled={disabled} onClick={onClick} size="icon-lg" type="button" variant={active ? "secondary" : "ghost"}>
      {children}
    </Button>
  );
}

function BlockingState({ actions, presentation }: MaterialAuthoringWorkspaceProps) {
  if (presentation.blocking.kind === "none") {
    return null;
  }
  if (presentation.blocking.kind === "conflict") {
    return (
      <div className="border-b border-border bg-destructive/8 px-4 py-5 sm:px-6" role="alert">
        <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex max-w-2xl gap-3">
            <CircleAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold">Материал изменился в другой сессии</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Сравните изменения или откройте сохранённый материал в новой вкладке для ручного переноса. Ваш локальный ввод останется здесь.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { actions.onConflictAction("compare"); }} type="button">Сравнить</Button>
            <Button onClick={() => { actions.onConflictAction("open_current"); }} type="button" variant="outline">Открыть текущую</Button>
            <Button onClick={() => { actions.onConflictAction("copy"); }} type="button" variant="ghost">Скопировать мои изменения</Button>
          </div>
        </div>
      </div>
    );
  }
  if (presentation.blocking.kind === "not_found") {
    return (
      <div className="border-b border-border bg-destructive/8 px-4 py-5 sm:px-6" role="alert">
        <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex max-w-2xl gap-3">
            <CircleAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold">Материал больше не найден</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Он мог быть удалён в другой сессии. Ложное сохранение не показано.
              </p>
            </div>
          </div>
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
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Изменения остаются в редакторе. Проверьте соединение и повторите сохранение.</p>
            <p className="mt-2 font-mono text-[0.6875rem] text-muted-foreground">Код обращения: {presentation.blocking.correlationId}</p>
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

function AuthoringNotice({
  presentation,
}: {
  readonly presentation: MaterialAuthoringPresentation;
}) {
  const noticeKey = `${String(presentation.noticeRevision)}:${presentation.validation.kind}:${presentation.save.kind}:${String(presentation.draft.contentVersion)}`;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    if (presentation.validation.kind === "idle") {
      return;
    }
    const timer = window.setTimeout(() => {
      setDismissedKey(noticeKey);
    }, 3_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [noticeKey, presentation.validation.kind]);

  if (presentation.validation.kind === "idle") {
    return null;
  }
  const inputInvalid =
    presentation.validation.kind === "invalid" &&
    presentation.validation.scope === "input";
  const created =
    presentation.save.kind === "saved" &&
    presentation.draft.contentVersion !== null;
  if (
    dismissedKey === noticeKey ||
    (!inputInvalid && !created && presentation.validation.kind !== "checking")
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
          <LoaderCircle aria-hidden="true" className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />
        ) : inputInvalid ? (
          <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-destructive" />
        ) : (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
            <Check aria-hidden="true" className="size-3.5" />
          </span>
        )}
        <p className="min-w-0 text-sm font-semibold leading-5">
          {presentation.validation.kind === "checking"
            ? presentation.draft.status === "new"
              ? "Создаём черновик"
              : "Сохраняем материал"
            : inputInvalid
              ? "Проверьте поля"
              : presentation.draft.status === "new"
                ? "Черновик создан"
                : "Материал сохранён"}
        </p>
      </div>
    </div>
  );
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

function hasIssue(
  presentation: MaterialAuthoringPresentation,
  pathSuffix: string,
): boolean {
  return (
    presentation.validation.kind === "invalid" &&
    presentation.validation.issues.some((issue) => issue.path.endsWith(pathSuffix))
  );
}
