"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  ArrowLeft,
  Bold,
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
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";
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
  MaterialValidationState,
} from "../model/presentation";
import { MaterialRevisionPreview } from "./material-revision-preview";

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
    return <UnauthorizedState onBack={actions.onBack} />;
  }

  if (presentation.mode === "preview" && presentation.preview !== null) {
    return (
      <ExactPreview
        onReturnToEditor={actions.onReturnToEditor}
        onValidate={actions.onValidate}
        presentation={presentation}
      />
    );
  }

  return (
    <section
      aria-labelledby="material-editor-heading"
      className="@container/material-authoring min-h-svh bg-background text-foreground"
      data-material-authoring
    >
      <EditorHeader actions={actions} presentation={presentation} />
      <RevisionRail presentation={presentation} />
      <BlockingState actions={actions} presentation={presentation} />

      <form
        className="mx-auto grid w-full max-w-[92rem] min-w-0 gap-0 px-4 pb-14 pt-6 sm:px-6 @min-[68rem]/material-authoring:grid-cols-[minmax(14rem,0.72fr)_minmax(28rem,1.8fr)_minmax(15rem,0.8fr)] @min-[68rem]/material-authoring:px-8"
        onSubmit={(event) => {
          event.preventDefault();
          actions.onSave();
        }}
      >
        <MetadataPanel actions={actions} presentation={presentation} />
        <DocumentPanel actions={actions} presentation={presentation} />
        <ValidationPanel actions={actions} presentation={presentation} />
      </form>
    </section>
  );
}

function EditorHeader({
  actions,
  presentation,
}: MaterialAuthoringWorkspaceProps) {
  const previewDisabled =
    presentation.draft.revisionId === null ||
    presentation.save.kind === "dirty" ||
    presentation.save.kind === "submitting" ||
    presentation.validation.kind === "invalid" ||
    presentation.blocking.kind !== "none";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 px-4 py-3 backdrop-blur-sm supports-[backdrop-filter]:bg-card/88 sm:px-6">
      <div className="mx-auto flex w-full max-w-[92rem] flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button aria-label="Вернуться к материалам" onClick={actions.onBack} size="icon-lg" type="button" variant="ghost">
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{presentation.draft.status === "new" ? "Новый Material" : "Черновик"}</span>
              {presentation.draft.revisionId === null ? null : (
                <span className="truncate font-mono">{presentation.draft.revisionId}</span>
              )}
            </div>
            <h1 className="truncate text-base font-semibold tracking-[-0.02em] sm:text-lg" id="material-editor-heading">
              {presentation.draft.title.length > 0 ? presentation.draft.title : "Новый материал"}
            </h1>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 items-center gap-2 sm:ml-auto sm:flex sm:w-auto">
          <SaveStatus state={presentation.save} />
          <Button disabled={previewDisabled} onClick={actions.onOpenPreview} type="button" variant="outline">
            <Eye aria-hidden="true" data-icon="inline-start" />
            Preview
          </Button>
          <Button disabled={presentation.save.kind !== "dirty" || presentation.blocking.kind !== "none"} onClick={actions.onSave} type="button">
            {presentation.save.kind === "submitting" ? (
              <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" data-icon="inline-start" />
            ) : (
              <Save aria-hidden="true" data-icon="inline-start" />
            )}
            {presentation.save.kind === "submitting" ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </header>
  );
}

function RevisionRail({ presentation }: { readonly presentation: MaterialAuthoringPresentation }) {
  return (
    <div className="border-b border-border bg-card px-4 sm:px-6">
      <dl className="relative mx-auto grid w-full max-w-[92rem] grid-cols-1 gap-2 py-3 font-mono text-[0.6875rem] sm:grid-cols-3 sm:gap-4 before:absolute before:bottom-0 before:left-0 before:h-px before:w-full before:bg-accent">
        <RevisionFact label="Редакция" value={presentation.draft.revisionId ?? "ещё не создана"} />
        <RevisionFact label="Сохранение" value={saveStateLabel(presentation.save)} />
        <RevisionFact label="Проверка" value={validationStateLabel(presentation.validation)} />
      </dl>
    </div>
  );
}

function RevisionFact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-semibold text-foreground sm:mt-1">{value}</dd>
    </div>
  );
}

function MetadataPanel({
  actions,
  presentation,
}: MaterialAuthoringWorkspaceProps) {
  const disabled = presentation.save.kind === "submitting" || presentation.blocking.kind !== "none";
  const titleIssueId = validationIssueId(presentation.validation, "material-title");
  const summaryIssueId = validationIssueId(presentation.validation, "material-summary");
  const topicIssueId = validationIssueId(presentation.validation, "material-topic");

  return (
    <fieldset className="min-w-0 border-0 border-b border-border pb-7 @min-[68rem]/material-authoring:border-b-0 @min-[68rem]/material-authoring:border-r @min-[68rem]/material-authoring:pb-0 @min-[68rem]/material-authoring:pr-7" disabled={disabled}>
      <legend className="text-sm font-semibold">Параметры материала</legend>
      <div className="mt-5 space-y-5">
        <Field label="Название" targetId="material-title">
          <input
            aria-describedby={titleIssueId}
            aria-invalid={titleIssueId === undefined ? undefined : true}
            className={fieldClassName}
            id="material-title"
            onChange={(event) => {
              actions.onFieldChange("title", event.currentTarget.value);
            }}
            value={presentation.draft.title}
          />
        </Field>
        <Field label="Краткое описание" targetId="material-summary">
          <textarea
            aria-describedby={summaryIssueId}
            aria-invalid={summaryIssueId === undefined ? undefined : true}
            className={cn(fieldClassName, "min-h-28 resize-y py-3 leading-6")}
            id="material-summary"
            onChange={(event) => {
              actions.onFieldChange("summary", event.currentTarget.value);
            }}
            value={presentation.draft.summary}
          />
        </Field>
        <Field label="Тема" targetId="material-topic">
          <input
            aria-describedby={topicIssueId}
            aria-invalid={topicIssueId === undefined ? undefined : true}
            className={fieldClassName}
            id="material-topic"
            onChange={(event) => {
              actions.onFieldChange("topic", event.currentTarget.value);
            }}
            value={presentation.draft.topic}
          />
        </Field>
        <Field label="Формат" targetId="material-format">
          <Select
            disabled={disabled}
            onValueChange={(value) => {
              actions.onFieldChange("format", value);
            }}
            value={presentation.draft.format}
          >
            <SelectTrigger id="material-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Текст">Текст</SelectItem>
              <SelectItem value="Guide">Guide</SelectItem>
              <SelectItem value="Видео">Видео</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field hint="Через запятую" label="Теги" targetId="material-tags">
          <input
            className={fieldClassName}
            id="material-tags"
            onChange={(event) => {
              actions.onFieldChange("tags", event.currentTarget.value);
            }}
            value={presentation.draft.tags}
          />
        </Field>
        <Field label="Доступ" targetId="material-access">
          <Select
            disabled={disabled}
            onValueChange={(value) => {
              actions.onFieldChange("access", value);
            }}
            value={presentation.draft.access}
          >
            <SelectTrigger id="material-access">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Бесплатный</SelectItem>
              <SelectItem value="membership">Для участников</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </fieldset>
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
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium" htmlFor={targetId}>{label}</label>
        {hint === undefined ? null : <span className="font-mono text-[0.6875rem] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const fieldClassName =
  "min-h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

function DocumentPanel({ actions, presentation }: MaterialAuthoringWorkspaceProps) {
  return (
    <section aria-labelledby="document-heading" className="min-w-0 border-b border-border py-7 @min-[68rem]/material-authoring:border-b-0 @min-[68rem]/material-authoring:px-8 @min-[68rem]/material-authoring:py-0">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold" id="document-heading">Содержимое редакции</h2>
          <p className="mt-1 text-sm text-muted-foreground">Изменения войдут в следующую immutable revision после сохранения.</p>
        </div>
      </div>
      <MaterialDocumentEditor
        disabled={presentation.save.kind === "submitting" || presentation.blocking.kind !== "none"}
        document={presentation.draft.document}
        invalidIssueId={validationIssueId(presentation.validation, "material-body")}
        onChange={actions.onDocumentChange}
      />
    </section>
  );
}

function MaterialDocumentEditor({
  disabled,
  document,
  invalidIssueId,
  onChange,
}: {
  readonly disabled: boolean;
  readonly document: MaterialAuthoringPresentation["draft"]["document"];
  readonly invalidIssueId: string | undefined;
  readonly onChange: MaterialAuthoringActions["onDocumentChange"];
}) {
  const editor = useEditor({
    content: document,
    editable: !disabled,
    extensions: [StarterKit],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        ...(invalidIssueId === undefined
          ? {}
          : { "aria-describedby": invalidIssueId, "aria-invalid": "true" }),
        "aria-label": "Содержимое редакции материала",
        "aria-multiline": "true",
        id: "material-body",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getJSON());
    },
  });

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
    <Button aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} size="icon-lg" type="button" variant={active ? "secondary" : "ghost"}>
      {children}
    </Button>
  );
}

function ValidationPanel({ actions, presentation }: MaterialAuthoringWorkspaceProps) {
  return (
    <aside aria-labelledby="validation-heading" className="min-w-0 pt-7 @min-[68rem]/material-authoring:border-l @min-[68rem]/material-authoring:border-border @min-[68rem]/material-authoring:pl-7 @min-[68rem]/material-authoring:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold" id="validation-heading">Проверка</h2>
        <Button disabled={presentation.save.kind === "submitting" || presentation.validation.kind === "checking" || presentation.blocking.kind !== "none"} onClick={actions.onValidate} size="sm" type="button" variant="outline">
          {presentation.validation.kind === "checking" ? "Проверяем…" : "Проверить"}
        </Button>
      </div>
      <ValidationContent state={presentation.validation} />
      <section aria-labelledby="resources-heading" className="mt-9 border-t border-border pt-7">
        <h2 className="text-sm font-semibold" id="resources-heading">Resources</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">В этой редакции нет изображений, файлов или видео.</p>
        <Button className="mt-4" disabled type="button" variant="outline">Добавить resource</Button>
      </section>
    </aside>
  );
}

function ValidationContent({ state }: { readonly state: MaterialValidationState }) {
  if (state.kind === "unchecked") {
    return <p className="mt-4 text-sm leading-6 text-muted-foreground">Проверка ещё не запускалась для этой редакции.</p>;
  }
  if (state.kind === "checking") {
    return (
      <div aria-live="polite" className="mt-4 flex gap-3 text-sm" role="status">
        <LoaderCircle aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
        <p className="font-semibold">Проверяем редакцию…</p>
      </div>
    );
  }
  if (state.kind === "valid") {
    return (
      <div className="mt-4 flex gap-3 text-sm" role="status">
        <Check aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-accent" />
        <div>
          <p className="font-semibold">Ошибок нет</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">Проверено {state.checkedAtLabel}</p>
        </div>
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="mt-4 flex gap-3 text-sm" role="alert">
        <CloudOff aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-destructive" />
        <div>
          <p className="font-semibold">Проверка недоступна</p>
          <p className="mt-1 leading-6 text-muted-foreground">{state.message}</p>
          <p className="mt-2 font-mono text-[0.6875rem] text-muted-foreground">Код обращения: {state.correlationId}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4" role="alert">
      <div className="flex gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-destructive" />
        <div>
          <p className="font-semibold">Материал пока нельзя опубликовать</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Исправьте отмеченные поля и blocks, затем повторите проверку.</p>
        </div>
      </div>
      <ul className="mt-5 space-y-3" role="list">
        {state.issues.map((issue) => (
          <li key={issue.id}>
            <button
              className="block w-full rounded-lg bg-destructive/10 px-3 py-3 text-left text-sm hover:bg-destructive/15 focus-visible:outline-ring"
              id={`validation-issue-${issue.id}`}
              onClick={() => {
                focusValidationTarget(issue.targetId);
              }}
              type="button"
            >
              <span className="font-semibold text-destructive">{issue.label}</span>
              <span className="mt-1 block text-foreground">{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
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
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Сравните текущую revision со своими изменениями. Ничего не перезаписано.</p>
              <p className="mt-2 font-mono text-[0.6875rem] text-muted-foreground">Ваш base: {presentation.blocking.staleRevisionId} · Current: {presentation.blocking.currentRevisionId}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { actions.onConflictAction("compare"); }} type="button">Сравнить</Button>
            <Button onClick={() => { actions.onConflictAction("reload"); }} type="button" variant="outline">Reload current</Button>
            <Button onClick={() => { actions.onConflictAction("copy"); }} type="button" variant="ghost">Copy my changes</Button>
          </div>
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
            <p className="font-semibold">Не удалось сохранить редакцию</p>
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

function ExactPreview({
  onReturnToEditor,
  onValidate,
  presentation,
}: {
  readonly onReturnToEditor: () => void;
  readonly onValidate: () => void;
  readonly presentation: MaterialAuthoringPresentation;
}) {
  const preview = presentation.preview;
  if (preview === null) {
    return null;
  }
  return (
    <section aria-labelledby="exact-preview-heading" className="min-h-svh bg-background text-foreground" data-exact-preview>
      <header className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar px-4 py-3 text-sidebar-foreground sm:px-6">
        <div className="mx-auto flex w-full max-w-[92rem] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={onReturnToEditor} size="icon-lg" type="button" variant="ghost">
              <ArrowLeft aria-hidden="true" />
              <span className="sr-only">Вернуться в редактор</span>
            </Button>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold" id="exact-preview-heading">Preview exact revision</h1>
              <p className="truncate font-mono text-[0.6875rem] text-sidebar-foreground/70">{preview.exactRevisionId} · private · no-store</p>
              <PreviewValidationStatus state={presentation.validation} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button className="border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-border" disabled={presentation.validation.kind === "checking"} onClick={onValidate} type="button" variant="outline">
              {presentation.validation.kind === "checking" ? "Проверяем…" : "Проверить"}
            </Button>
            <Button className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/85" onClick={onReturnToEditor} type="button">Вернуться в редактор</Button>
          </div>
        </div>
      </header>
      <div className="border-b border-border bg-card px-4 py-3 text-center font-mono text-[0.6875rem] text-muted-foreground" data-preview-revision-banner>
        Вы просматриваете <strong className="text-foreground">{preview.exactRevisionId}</strong>. Preview не меняет опубликованную редакцию.
      </div>
      <MaterialRevisionPreview preview={preview} />
    </section>
  );
}

function PreviewValidationStatus({ state }: { readonly state: MaterialValidationState }) {
  if (state.kind === "checking") {
    return (
      <span aria-live="polite" className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-sidebar-foreground/80" role="status">
        <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
        Проверяем exact revision…
      </span>
    );
  }
  if (state.kind === "valid") {
    return <span className="mt-1 block text-[0.6875rem] text-sidebar-foreground/80" role="status">Ошибок нет · {state.checkedAtLabel}</span>;
  }
  if (state.kind === "invalid") {
    return <span className="mt-1 block text-[0.6875rem] text-sidebar-foreground/80" role="status">Найдено ошибок: {state.issues.length}</span>;
  }
  if (state.kind === "failed") {
    return <span className="mt-1 block text-[0.6875rem] text-sidebar-foreground/80" role="alert">Проверка недоступна · {state.correlationId}</span>;
  }
  return <span className="mt-1 block text-[0.6875rem] text-sidebar-foreground/70">Проверка не запускалась</span>;
}

function UnauthorizedState({ onBack }: { readonly onBack: () => void }) {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 py-12 text-foreground">
      <section aria-labelledby="unauthorized-heading" className="w-full max-w-xl border-y border-border py-10 text-center">
        <ShieldAlert aria-hidden="true" className="mx-auto size-8 text-destructive" />
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.025em]" id="unauthorized-heading">Нет доступа к редактору</h1>
        <p className="mx-auto mt-3 max-w-[52ch] text-sm leading-6 text-muted-foreground">Текущая сессия не подтверждает право изменять материалы. Войдите под доверенным автором или вернитесь к материалам.</p>
        <Button className="mt-6" onClick={onBack} type="button" variant="outline">
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          Вернуться к материалам
        </Button>
      </section>
    </main>
  );
}

function SaveStatus({ state }: { readonly state: MaterialSaveState }) {
  return (
    <span className="hidden min-w-0 items-center gap-1.5 font-mono text-[0.6875rem] text-muted-foreground sm:inline-flex" role="status">
      {state.kind === "submitting" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" /> : state.kind === "saved" ? <Check aria-hidden="true" className="size-3.5 text-accent" /> : null}
      {saveStateLabel(state)}
    </span>
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

function validationStateLabel(state: MaterialValidationState): string {
  switch (state.kind) {
    case "unchecked":
      return "Не запускалась";
    case "checking":
      return "Выполняется…";
    case "valid":
      return "Ошибок нет";
    case "invalid":
      return `${String(state.issues.length)} ${state.issues.length === 1 ? "ошибка" : "ошибки"}`;
    case "failed":
      return "Недоступна";
  }
}

function validationIssueId(
  state: MaterialValidationState,
  targetId: string,
): string | undefined {
  if (state.kind !== "invalid") {
    return undefined;
  }
  const issue = state.issues.find((candidate) => candidate.targetId === targetId);
  return issue === undefined ? undefined : `validation-issue-${issue.id}`;
}

function focusValidationTarget(targetId: string): void {
  const target = document.getElementById(targetId);
  target?.scrollIntoView({ block: "center" });
  target?.focus({ preventScroll: true });
}
