"use client";

import { Archive, ArrowLeft, RotateCcw } from "lucide-react";

import { ContentCoverEditor } from "@/features/content-covers";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import { StateBadge } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import type {
  ContentCollection,
  ContentCollectionMutationResult,
} from "../model/content-collections";
import { useCollectionDraft } from "../model/use-collection-draft.client";
import {
  CollectionField,
  collectionFieldClassName,
} from "./collection-create-form.client";
import { MutationNotice } from "./collection-mutation-notice";

/**
 * Тема, открытая из списка по адресу `?topic=`: название, описание, обложка и архив с
 * автосохранением. Редактор остаётся смонтированным, когда автор возвращается к списку, поэтому
 * несохранённый черновик и запись в полёте не теряются.
 */
export function TopicEditor({
  collection,
  headingId,
  onSaved,
  onClose,
}: {
  readonly collection: ContentCollection;
  readonly headingId: string;
  readonly onSaved: (result: ContentCollectionMutationResult) => void;
  /** Возврат к списку; вызывается, когда правки сохранены. */
  readonly onClose: () => void;
}) {
  const {
    name,
    setName,
    summary,
    setSummary,
    cover,
    setCover,
    setArchived,
    update,
    archive,
    autosave,
  } = useCollectionDraft(collection, onSaved);
  return (
    <section aria-labelledby={headingId} className="grid gap-6">
      <nav
        aria-label="Навигация темы"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4"
      >
        <Button
          onClick={() => {
            void flushPendingEdits().then((ok) => {
              if (ok) onClose();
            });
          }}
          type="button"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" />
          Все темы
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground" role="status">
            {autosave.pending
              ? "Сохранение…"
              : autosave.dirty
                ? "Не сохранено"
                : "Сохранено"}
          </span>
          <Button
            disabled={archive.isPending}
            onClick={() => {
              setArchived(!collection.archived);
            }}
            type="button"
            variant="ghost"
          >
            {collection.archived ? (
              <RotateCcw aria-hidden="true" />
            ) : (
              <Archive aria-hidden="true" />
            )}
            {collection.archived ? "Вернуть из архива" : "В архив"}
          </Button>
        </div>
      </nav>
      <header className="authoring-page-heading">
        <h1
          className="outline-none [overflow-wrap:anywhere]"
          id={headingId}
          tabIndex={-1}
        >
          {name.trim() === "" ? collection.name : name}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="break-all">/{collection.slug}</span>
          <span>
            Опубликовано {String(collection.publishedMaterialCount)} из{" "}
            {String(collection.materialCount)}
          </span>
          <StateBadge
            state={collection.archived ? "topic.archived" : "topic.active"}
          />
        </p>
      </header>
      <h2 className="sr-only">Описание темы</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <CollectionField label="Название">
          <input
            className={collectionFieldClassName}
            maxLength={120}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
            required
            value={name}
          />
        </CollectionField>
        <CollectionField label="Краткое описание">
          <textarea
            className={`${collectionFieldClassName} min-h-20 py-2`}
            maxLength={500}
            onChange={(event) => {
              setSummary(event.currentTarget.value);
            }}
            value={summary}
          />
        </CollectionField>
        <ContentCoverEditor
          initialCover={cover}
          onChange={setCover}
          ownerId={collection.id}
          ownerKind={collection.kind}
          ownerLabel={name}
        />
      </div>
      {autosave.error ? (
        <div>
          <Button
            onClick={() => {
              void autosave.retry();
            }}
            type="button"
            variant="outline"
          >
            Повторить сохранение
          </Button>
        </div>
      ) : null}
      <MutationNotice
        onRefresh={() => {
          window.location.reload();
        }}
        result={autosave.error ? (update.data ?? null) : (archive.data ?? null)}
      />
    </section>
  );
}
