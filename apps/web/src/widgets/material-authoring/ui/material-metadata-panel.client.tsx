"use client";

import { BookOpen, Check } from "lucide-react";
import type { ReactNode } from "react";

import { materialTaxonomyLabel } from "@/entities/material";
import { MaterialDeleteDialog } from "@/features/material-lifecycle";
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
} from "../model/presentation";

interface MaterialMetadataPanelProps {
  readonly actions: MaterialAuthoringActions;
  readonly presentation: MaterialAuthoringPresentation;
}

export function MaterialMetadataPanel({
  actions,
  presentation,
}: MaterialMetadataPanelProps) {
  const disabled =
    presentation.save.kind === "submitting" ||
    presentation.blocking.kind !== "none" ||
    presentation.draft.readOnly;

  return (
    <section
      aria-labelledby="material-parameters-heading"
      className="min-w-0 border-b border-border pb-7 @min-[68rem]/material-authoring:border-b-0 @min-[68rem]/material-authoring:border-r @min-[68rem]/material-authoring:pb-0 @min-[68rem]/material-authoring:pr-7"
    >
      <h2 className="text-sm font-semibold" id="material-parameters-heading">
        Параметры материала
      </h2>
      <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2 @min-[68rem]/material-authoring:grid-cols-1">
        <Field label="Название" targetId="material-title">
          <input
            aria-describedby={
              hasIssue(presentation, "/title") ? "material-guidance-heading" : undefined
            }
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
            aria-describedby={
              hasIssue(presentation, "/summary") ? "material-guidance-heading" : undefined
            }
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
        <TaxonomySelect
          disabled={disabled}
          emptyLabel="Не назначена"
          field="topicId"
          label="Тема"
          options={presentation.availableTopics}
          value={presentation.draft.topicId}
          onChange={actions.onFieldChange}
        />
        <TaxonomySelect
          disabled={disabled}
          emptyLabel="Не назначен"
          field="formatId"
          label="Формат"
          options={presentation.availableFormats}
          value={presentation.draft.formatId}
          onChange={actions.onFieldChange}
        />
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
              <SelectItem className={authoringSelectItemClassName} value="free">
                Бесплатный
              </SelectItem>
              <SelectItem className={authoringSelectItemClassName} value="membership">
                Для участников
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <FormGuidance presentation={presentation} />
      {presentation.draft.canDelete &&
      presentation.draft.materialId !== null &&
      presentation.draft.contentVersion !== null ? (
        <section aria-labelledby="material-delete-heading" className="mt-7 border-t border-border pt-6">
          <h2 className="text-sm font-semibold" id="material-delete-heading">
            Удаление черновика
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Доступно только пока Материал ни разу не публиковался.
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

function TaxonomySelect({
  disabled,
  emptyLabel,
  field,
  label,
  onChange,
  options,
  value,
}: {
  readonly disabled: boolean;
  readonly emptyLabel: string;
  readonly field: "formatId" | "topicId";
  readonly label: string;
  readonly onChange: MaterialAuthoringActions["onFieldChange"];
  readonly options: MaterialAuthoringPresentation["availableFormats"];
  readonly value: string;
}) {
  const targetId = `material-${field === "topicId" ? "topic" : "format"}`;
  return (
    <Field label={label} targetId={targetId}>
      <Select
        disabled={disabled}
        name={field}
        onValueChange={(nextValue) => {
          onChange(field, nextValue);
        }}
        value={value}
      >
        <SelectTrigger className={authoringSelectTriggerClassName} id={targetId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem className={authoringSelectItemClassName} value="unassigned">
            {emptyLabel}
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              className={authoringSelectItemClassName}
              key={option.value}
              value={option.value}
            >
              {materialTaxonomyLabel(option.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
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
            <span aria-hidden="true" className="text-accent">
              •
            </span>
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
}: MaterialMetadataPanelProps & { readonly disabled: boolean }) {
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
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg",
                  checked ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground",
                )}
              >
                <BookOpen aria-hidden="true" className="size-4" />
              </span>
              <span className="truncate">{series.label}</span>
              <span
                className={cn(
                  "ml-auto grid size-6 shrink-0 place-items-center rounded-full border",
                  checked
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border text-transparent",
                )}
              >
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
}: MaterialMetadataPanelProps & { readonly disabled: boolean }) {
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
          <span className="px-1 py-1.5 text-sm text-muted-foreground">
            Нет доступных тегов
          </span>
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
  label,
  targetId,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly targetId: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium" htmlFor={targetId}>
          {label}
        </label>
      </div>
      {children}
    </div>
  );
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

const fieldClassName =
  "min-h-12 w-full rounded-xl border border-input bg-card px-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:min-h-11 sm:text-sm";

const authoringSelectTriggerClassName = "min-h-12 text-base sm:min-h-11 sm:text-sm";
const authoringSelectItemClassName = "min-h-11 sm:min-h-10";
